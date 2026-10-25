<?php

namespace App\Support;

use App\Models\CostCenter;
use App\Models\Tenant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

final class CostCenterQuery
{
    /** @return Builder<CostCenter> */
    public static function filtered(Tenant $tenant, Request $request): Builder
    {
        $query = $tenant->costCenters()->whereNull('parent_id')
            ->withCount(['expenses', 'projects', 'contracts'])
            ->with(['children' => fn ($query) => $query->withCount(['expenses', 'projects', 'contracts'])]);
        $search = $request->string('search')->trim()->toString();
        if ($search !== '') {
            $pattern = TableSearch::pattern($search);
            $query->where(fn ($query) => $query->whereRaw("LOWER(name) LIKE ? ESCAPE '!'", [$pattern])
                ->orWhereHas('children', fn ($children) => $children->whereRaw("LOWER(name) LIKE ? ESCAPE '!'", [$pattern])));
        }

        return $query->getQuery();
    }
}
