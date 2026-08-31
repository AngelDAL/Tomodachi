<?php
/**
 * FormatHelper — formato regional para SALIDAS del backend
 * (mensajes de error, correos, tickets).
 *
 * IMPORTANTE: esto NO se usa para consultas SQL — SQL siempre recibe
 * fechas en YYYY-MM-DD / YYYY-MM-DD HH:MM:SS y números crudos.
 * Solo formatea texto que se muestra al usuario.
 */
class FormatHelper {

    /** Lee el objeto format del settings JSON de una tienda (o defaults). */
    public static function getFormat($db, $store_id) {
        $defaults = [
            'currency_code' => 'MXN',
            'currency_symbol' => '$',
            'symbol_position' => 'before',
            'thousands_sep' => ',',
            'decimal_sep' => '.',
            'decimals' => 2,
            'date_format' => 'DD/MM/YYYY',
            'time_format' => '24h',
            'locale' => 'es-MX'
        ];
        try {
            $store = $db->selectOne('SELECT settings FROM stores WHERE store_id = ?', [$store_id]);
            if ($store && $store['settings']) {
                $settings = json_decode($store['settings'], true);
                if (is_array($settings) && isset($settings['format']) && is_array($settings['format'])) {
                    return array_merge($defaults, $settings['format']);
                }
            }
        } catch (Exception $e) { /* defaults */ }
        return $defaults;
    }

    /** Formatea un número con separadores de la config. */
    public static function number($amount, $format = null) {
        $f = $format ?: [];
        $decimals = isset($f['decimals']) ? (int)$f['decimals'] : 2;
        $decimals = max(0, min(4, $decimals));
        $decimalSep = isset($f['decimal_sep']) ? $f['decimal_sep'] : '.';
        $thousandsSep = isset($f['thousands_sep']) ? $f['thousands_sep'] : ',';
        if ($thousandsSep === 'space') $thousandsSep = "\u{00A0}";
        if ($thousandsSep === 'none') $thousandsSep = '';
        return number_format((float)$amount, $decimals, $decimalSep, $thousandsSep);
    }

    /** Formatea un monto como moneda según la config. */
    public static function currency($amount, $format = null) {
        $f = $format ?: [];
        $body = self::number($amount, $f);
        $symbol = isset($f['currency_symbol']) ? $f['currency_symbol'] : '$';
        $pos = isset($f['symbol_position']) ? $f['symbol_position'] : 'before';
        if (!$symbol || $pos === 'none') return $body;
        if ($pos === 'after') return $body . ' ' . $symbol;
        return $symbol . $body;
    }

    /** Fecha legible según date_format (SOLO para mostrar, nunca para SQL). */
    public static function date($dateStr, $format = null, $withTime = true) {
        $f = $format ?: [];
        $ts = is_numeric($dateStr) ? (int)$dateStr : strtotime($dateStr);
        if (!$ts) return (string)$dateStr;
        $dateFmt = isset($f['date_format']) ? $f['date_format'] : 'DD/MM/YYYY';
        $map = [
            'DD/MM/YYYY' => 'd/m/Y',
            'MM/DD/YYYY' => 'm/d/Y',
            'YYYY-MM-DD' => 'Y-m-d',
            'DD-MM-YYYY' => 'd-m-Y'
        ];
        $phpDate = isset($map[$dateFmt]) ? $map[$dateFmt] : 'd/m/Y';
        $timeFmt = (isset($f['time_format']) && $f['time_format'] === '12h') ? 'h:i A' : 'H:i';
        return $withTime ? date($phpDate . ' ' . $timeFmt, $ts) : date($phpDate, $ts);
    }
}
