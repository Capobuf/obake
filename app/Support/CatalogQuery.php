<?php

namespace App\Support;

use App\Models\Contract;
use App\Models\Project;
use App\Models\Tenant;
use App\Models\Vendor;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

final class CatalogQuery
{
    /** @return Builder<Vendor|Contract|Project> */
    public static function filtered(Tenant $tenant, string $catalog, Request $request): Builder
    {
        $query = (match ($catalog) {
            'vendors' => $tenant->vendors(),
            'contracts' => $tenant->contracts(),
            'projects' => $tenant->projects(),
            default => abort(404),
        })->withCount('expenses');
        if ($catalog !== 'vendors') {
            $query->with('costCenters.parent:id,name')->where(fn ($q) => $q->where('year', EconomicYearContext::year($tenant, $request))->orWhereNull('year'));
        }
        if ($catalog === 'contracts') {
            $query->with('vendor:id,name');
            if ($request->filled('vendor_id')) {
                $query->where('vendor_id', $request->integer('vendor_id'));
            }
            if ($request->input('expiring') === '1') {
                $query->whereBetween('ends_on', [now()->toDateString(), now()->addDays(90)->toDateString()]);
            }
        }
        if ($catalog === 'projects' && $request->filled('status')) {
            $request->input('status') === 'none'
                ? $query->whereNull('status')
                : $query->where('status', $request->input('status'));
        }
        if ($catalog === 'vendors' && $request->input('linked') === '1') {
            $query->whereHas('expenses');
        }
        $search = $request->string('search')->trim()->toString();
        if ($search !== '') {
            $pattern = TableSearch::pattern($search);
            $amount = TableSearch::amount($search);
            $expenses = ExpenseOverview::search(ExpenseOverview::economicQuery($tenant)
                ->where('year', EconomicYearContext::year($tenant, $request)), $search);
            $field = match ($catalog) {
                'vendors' => 'vendor_id', 'contracts' => 'contract_id', 'projects' => 'project_id',
            };
            $query->where(function ($match) use ($catalog, $tenant, $pattern, $amount, $expenses, $field) {
                $fields = match ($catalog) {
                    'vendors' => ['name', 'notes', 'vat_number', 'email', 'phone'],
                    'contracts' => ['name', 'notes'],
                    'projects' => ['name', 'description', 'status'],
                };
                foreach ($fields as $column) {
                    $match->orWhereRaw("LOWER($catalog.$column) LIKE ? ESCAPE '!'", [$pattern]);
                }
                if ($catalog !== 'vendors') {
                    foreach (['costCenters', 'costCenters.parent'] as $relation) {
                        $match->orWhereHas($relation, fn ($related) => $related->whereRaw("LOWER(name) LIKE ? ESCAPE '!'", [$pattern]));
                    }
                }
                if ($catalog === 'projects') {
                    $match->orWhereIn('status', $tenant->projectStatuses()->whereRaw("LOWER(name) LIKE ? ESCAPE '!'", [$pattern])->select('key'));
                }
                if ($catalog === 'contracts') {
                    $match->orWhereHas('vendor', fn ($vendor) => $vendor->whereRaw("LOWER(name) LIKE ? ESCAPE '!'", [$pattern]));
                    if ($amount !== null) {
                        $match->orWhere('reference_amount', $amount);
                    }
                }
                $match->orWhereIn($catalog.'.id', $expenses->select($field));
            });
        }

        /** @var Builder<Vendor|Contract|Project> $builder */
        $builder = $query->getQuery();

        return $builder;
    }
}
