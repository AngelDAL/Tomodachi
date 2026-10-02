<?php
/**
 * Renderizador de tickets ESC/POS (TAB-22).
 *
 * POR QUÉ EXISTE
 * La cola `print_jobs` guarda los BYTES ya renderizados, no una descripción del
 * ticket. Eso es deliberado: el worker nunca reinterpreta el contenido de una
 * comanda, solo escribe lo que ya está en la fila. Si el ticket se pudiera
 * regenerar en el worker, un cambio de producto o de precio entre el `send` y la
 * impresión haría salir un ticket distinto al que el mesero mandó.
 *
 * QUÉ HACE Y QUÉ NO
 * - Solo construye bytes. No abre sockets (eso es `PrintQueue`), no toca la base
 *   y no sabe de tiendas.
 * - No calcula tiempo: la hora del ticket llega ya formateada en `hora_local`
 *   (la calcula ComandaService; aquí no se resta ninguna zona horaria).
 *
 * Idiomas de impresora soportados: ESC/POS estándar (Epson y compatibles), con
 * juego de caracteres cp437 o cp850, 58 mm u 80 mm.
 */
class EscPos {

    const ESC = "\x1B";
    const GS  = "\x1D";

    /** Columnas de la fuente A por ancho de papel, en milímetros. */
    const COLUMNAS = [
        '58' => 32,
        '80' => 48,
    ];

    /**
     * Ancho en columnas del papel de una salida.
     *
     * @param string|null $paper_width '58' | '80'
     */
    public static function columnas($paper_width) {
        $w = (string)$paper_width;
        return self::COLUMNAS[$w] ?? self::COLUMNAS['80'];
    }

    /**
     * Convierte texto UTF-8 al juego de caracteres de la impresora.
     *
     * Las impresoras ESC/POS no son UTF-8: si se les manda un acento en UTF-8
     * salen dos bytes basura. `//TRANSLIT` degrada lo que no exista en el set
     * (una "ñ" en cp437 sí existe; un emoji, no) en vez de cortar la cadena, que
     * es el modo de falla silencioso que hay que evitar. Si iconv no está
     * disponible se cae a ASCII imprimible: se pierden acentos, no el ticket.
     */
    public static function aCharset($texto, $charset) {
        $texto = (string)$texto;
        if ($texto === '') {
            return '';
        }
        $tabla = strtolower((string)$charset) === 'cp437' ? 'CP437' : 'CP850';

        if (function_exists('iconv')) {
            $out = @iconv('UTF-8', $tabla . '//TRANSLIT', $texto);
            if ($out !== false) {
                return $out;
            }
        }
        return preg_replace('/[^\x20-\x7E]/', '?', $texto);
    }

    /** Selección de tabla de caracteres: 0 = PC437, 2 = PC850. */
    private static function seleccionCharset($charset) {
        $n = strtolower((string)$charset) === 'cp437' ? 0 : 2;
        return self::ESC . 't' . chr($n);
    }

    /** Inicializa la impresora y fija el juego de caracteres. */
    public static function inicializar($charset = 'cp850') {
        return self::ESC . '@' . self::seleccionCharset($charset);
    }

    /** Alineación: 0 izquierda, 1 centro, 2 derecha. */
    public static function alinear($modo) {
        return self::ESC . 'a' . chr((int)$modo);
    }

    /** Negrita on/off. */
    public static function negrita($on) {
        return self::ESC . 'E' . chr($on ? 1 : 0);
    }

    /**
     * Tamaño de fuente. `$alto_doble` y `$ancho_doble` son del rango 1..2 en la
     * práctica (más allá se sale del papel).
     */
    public static function tamano($ancho_doble = false, $alto_doble = false) {
        $n = ($ancho_doble ? 0x10 : 0) | ($alto_doble ? 0x01 : 0);
        return self::GS . '!' . chr($n);
    }

    /** Avanza el papel n líneas. */
    public static function feed($lineas = 1) {
        return self::ESC . 'd' . chr(max(0, min(255, (int)$lineas)));
    }

    /** Pulso al cajón de dinero (pin 2). */
    public static function abrirCajon() {
        return self::ESC . 'p' . chr(0) . chr(25) . chr(250);
    }

    /** Corte de papel. */
    public static function cortar() {
        return self::GS . 'V' . chr(0);
    }

    /** Normaliza y recorta un texto al ancho disponible, sin partir palabras de más. */
    private static function recortar($texto, $columnas) {
        $texto = trim(preg_replace('/\s+/u', ' ', (string)$texto));
        if (function_exists('mb_strlen') && mb_strlen($texto, 'UTF-8') > $columnas) {
            return rtrim(mb_substr($texto, 0, $columnas - 1, 'UTF-8')) . '.';
        }
        if (!function_exists('mb_strlen') && strlen($texto) > $columnas) {
            return rtrim(substr($texto, 0, $columnas - 1)) . '.';
        }
        return $texto;
    }

    /** Una línea centrada, recortada al ancho del papel. */
    public static function centrar($texto, $columnas) {
        $t = self::recortar($texto, $columnas);
        $len = function_exists('mb_strlen') ? mb_strlen($t, 'UTF-8') : strlen($t);
        $pad = max(0, (int)floor(($columnas - $len) / 2));
        return str_repeat(' ', $pad) . $t;
    }

    /** Dos columnas: cantidad a la izquierda, nombre a la derecha. */
    public static function dosColumnas($izq, $der, $columnas) {
        $izq = self::recortar($izq, $columnas);
        $der = self::recortar($der, max(0, $columnas - strlen($izq) - 1));
        $hueco = max(1, $columnas - strlen($izq) - (function_exists('mb_strlen') ? mb_strlen($der, 'UTF-8') : strlen($der)));
        return $izq . str_repeat(' ', $hueco) . $der;
    }

    /** Separador horizontal del ancho del papel. */
    public static function separador($columnas, $caracter = '-') {
        return str_repeat($caracter, $columnas);
    }

    /**
     * Ticket de una comanda, listo para escribir en el 9100.
     *
     * @param array $comanda Estructura de ComandaService::formatear()
     * @param array $salida  Fila de `station_outputs` (paper_width, charset, has_drawer)
     * @return string Bytes ESC/POS
     */
    public static function ticketComanda(array $comanda, array $salida = []) {
        $columnas = self::columnas($salida['paper_width'] ?? '80');
        $charset  = $salida['charset'] ?? 'cp850';
        $b = self::inicializar($charset);

        // ── Encabezado: a quién le toca prepararlo ──
        $estacion = trim((string)($comanda['station_name'] ?? ''));
        if ($estacion !== '') {
            $b .= self::alinear(1) . self::negrita(true)
               . self::tamano(false, true)
               . self::aCharset(self::recortar($estacion, $columnas), $charset)
               . self::tamano() . self::negrita(false) . "\n";
        }

        $b .= self::alinear(1)
            . self::aCharset('Comanda #' . (int)($comanda['folio'] ?? 0)
                . '   ' . (string)($comanda['hora_local'] ?? ''), $charset) . "\n";
        $b .= self::alinear(0) . self::separador($columnas) . "\n";

        // ── Dónde se atiende y quién: lo que el piso necesita para no equivocarse ──
        $punto = trim((string)($comanda['punto'] ?? ''));
        if ($punto !== '') {
            $b .= self::aCharset('Punto: ' . self::recortar($punto, $columnas - 7), $charset) . "\n";
        }
        $code = trim((string)($comanda['code'] ?? ''));
        if ($code !== '') {
            $linea = 'Cuenta: ' . $code;
            if (!empty($comanda['personas_n'])) {
                $linea .= '   Personas: ' . (int)$comanda['personas_n'];
            }
            $b .= self::aCharset(self::recortar($linea, $columnas), $charset) . "\n";
        }
        $b .= self::separador($columnas) . "\n";

        // ── El contenido: qué y cuánto. A doble altura para leerlo de un vistazo ──
        foreach (($comanda['items'] ?? []) as $it) {
            if (!is_array($it) || ($it['status'] ?? '') === 'cancelled') {
                continue;
            }
            $cantidad = (float)($it['quantity'] ?? 0);
            $cant_txt = (floor($cantidad) == $cantidad) ? (string)(int)$cantidad : rtrim(rtrim(number_format($cantidad, 2, '.', ''), '0'), '.');
            $nombre   = (string)($it['product_name'] ?? '');

            $b .= self::tamano(false, true)
               . self::aCharset(self::recortar($cant_txt . ' x ' . $nombre, $columnas), $charset)
               . self::tamano() . "\n";

            $notas = trim((string)($it['notes'] ?? ''));
            if ($notas !== '') {
                $b .= self::aCharset('    > ' . self::recortar($notas, $columnas - 6), $charset) . "\n";
            }
        }

        // ── Nota general de la comanda ──
        $nota = trim((string)($comanda['notes'] ?? ''));
        if ($nota !== '') {
            $b .= self::separador($columnas) . "\n";
            $b .= self::negrita(true)
               . self::aCharset(self::recortar('Nota: ' . $nota, $columnas), $charset)
               . self::negrita(false) . "\n";
        }

        // ── El recordatorio incómodo pero honesto ──
        // El 9100 no confirma impresión física: decir "impresa" es decir que los
        // bytes salieron. Se imprime tal cual para que nadie lo confunda.
        $b .= self::separador($columnas) . "\n";
        $b .= self::aCharset('Enviado: ' . date('H:i:s'), $charset) . "\n";

        $b .= self::feed(3);
        if (!empty($salida['has_drawer'])) {
            $b .= self::abrirCajon();
        }
        $b .= self::cortar();
        return $b;
    }
}
