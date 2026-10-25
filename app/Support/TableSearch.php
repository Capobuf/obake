<?php

namespace App\Support;

final class TableSearch
{
    public static function pattern(string $search): string
    {
        return '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], mb_strtolower(trim($search))).'%';
    }

    public static function amount(string $search): ?string
    {
        $value = trim($search);
        if (preg_match('/^-?\d{1,3}(?:\.\d{3})+,\d{1,2}$/D', $value)) {
            $value = str_replace('.', '', $value);
        }
        $value = str_replace(',', '.', $value);
        if (! preg_match('/^-?\d{1,14}(?:\.\d{1,2})?$/D', $value)) {
            return null;
        }

        return Money::decimal(Money::cents($value));
    }
}
