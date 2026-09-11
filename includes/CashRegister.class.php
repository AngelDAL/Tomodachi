<?php
/**
 * CashRegister - Resolución de la caja a la que se aplica un movimiento de dinero.
 *
 * Regla del negocio: todo movimiento que toque dinero debe decir A QUÉ CAJA se
 * aplica, para que el administrador pueda separar sus gastos y saber cuánto sale
 * de cada una (por ejemplo, la compra de producto nuevo cargada a "BBVA" y no a
 * la caja del mostrador).
 *
 * Antes cada endpoint tomaba "la última caja abierta" a ciegas
 * (`SELECT register_id FROM cash_registers WHERE store_id=? AND status=? LIMIT 1`),
 * así que con varias cajas abiertas el movimiento caía en una cualquiera.
 *
 * Criterio:
 *   - Si llega register_id, se valida (que exista, sea de la tienda y esté
 *     abierta) y se usa.
 *   - Si no llega y hay UNA sola caja abierta, se usa esa: no tiene sentido
 *     molestar al usuario cuando no hay nada que elegir.
 *   - Si hay VARIAS abiertas, no se adivina: se pide elegir (multiple = true y
 *     la lista de opciones para que la interfaz pueda mostrarla).
 *   - Si no hay ninguna, se informa.
 */

class CashRegister {

    /**
     * Resuelve la caja de un movimiento.
     *
     * @param Database $db
     * @param int      $store_id    Tienda de la sesión
     * @param int      $register_id Caja propuesta (0 = no se especificó)
     * @return array{ok:bool, register_id:int, error:string, multiple:bool, options:array}
     */
    public static function resolve($db, $store_id, $register_id = 0) {
        $store_id    = (int)$store_id;
        $register_id = (int)$register_id;

        // 1. Caja propuesta explícitamente
        if ($register_id > 0) {
            $reg = $db->selectOne(
                'SELECT register_id, status FROM cash_registers WHERE register_id = ? AND store_id = ?',
                [$register_id, $store_id]
            );
            if (!$reg) {
                return self::fail('La caja indicada no existe en esta tienda.');
            }
            if ($reg['status'] !== REGISTER_OPEN) {
                return self::fail('La caja indicada está cerrada. Elige una caja abierta.');
            }
            return self::ok((int)$reg['register_id']);
        }

        // 2. Sin propuesta: decidir según cuántas haya abiertas
        $abiertas = self::openRegisters($db, $store_id);

        if (count($abiertas) === 1) {
            return self::ok((int)$abiertas[0]['register_id']);
        }
        if (count($abiertas) === 0) {
            return self::fail('No hay ninguna caja abierta en esta tienda. Abre una caja en Finanzas para registrar el movimiento.');
        }

        return [
            'ok'          => false,
            'register_id' => 0,
            'error'       => 'Hay varias cajas abiertas. Elige a cuál se aplica el movimiento.',
            'multiple'    => true,
            'options'     => $abiertas,
        ];
    }

    /**
     * Cajas abiertas de una tienda, con el nombre de su terminal (Caja A, BBVA...).
     */
    public static function openRegisters($db, $store_id) {
        return $db->select(
            'SELECT cr.register_id, cr.terminal_id, cr.opening_date, cr.initial_amount,
                    COALESCE(t.terminal_name, "Caja") AS terminal_name
               FROM cash_registers cr
               LEFT JOIN terminals t ON t.terminal_id = cr.terminal_id
              WHERE cr.store_id = ? AND cr.status = ?
              ORDER BY cr.opening_date ASC',
            [(int)$store_id, REGISTER_OPEN]
        );
    }

    /**
     * Respuesta de error lista para Response::error(...): 409 si falta elegir
     * entre varias, 422 en el resto de los casos.
     */
    public static function errorCode($result) {
        return !empty($result['multiple']) ? 409 : 422;
    }

    private static function ok($register_id) {
        return ['ok' => true, 'register_id' => $register_id, 'error' => '', 'multiple' => false, 'options' => []];
    }

    private static function fail($mensaje) {
        return ['ok' => false, 'register_id' => 0, 'error' => $mensaje, 'multiple' => false, 'options' => []];
    }
}
