<?php

namespace App\Http\Controllers\Tenant;

use App\Http\Controllers\Controller;
use App\Http\Requests\ExpenseRequest;
use App\Models\Contract;
use App\Models\Project;
use App\Models\Tenant;
use App\Models\Vendor;
use App\Services\AttachmentFiles;
use App\Services\ExpenseWriter;
use App\Support\CatalogQuery;
use App\Support\EconomicYearContext;
use App\Support\ExpenseAnalytics;
use App\Support\ExpenseOverview;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

class CatalogController extends Controller
{
    /** @return HasMany<Vendor, Tenant>|HasMany<Contract, Tenant>|HasMany<Project, Tenant> */
    private function records(Tenant $tenant, string $catalog): HasMany
    {
        return match ($catalog) {
            'vendors' => $tenant->vendors(),
            'contracts' => $tenant->contracts(),
            'projects' => $tenant->projects(),
            default => abort(404),
        };
    }

    public function index(Request $request, Tenant $tenant, string $catalog): Response
    {
        $query = CatalogQuery::filtered($tenant, $catalog, $request);
        $sort = in_array($request->input('sort'), ['name', 'updated_at', 'expenses_count'], true) ? $request->string('sort')->toString() : 'name';
        $direction = $request->input('direction') === 'desc' ? 'desc' : 'asc';

        return Inertia::render('tenants/catalog', [
            'tenant' => $tenant->only('id', 'name', 'slug'),
            'catalog' => $catalog,
            'records' => $query->orderBy($sort, $direction)->orderBy('id')->paginate(25)->withQueryString(),
            'filters' => [...$request->only('search', 'vendor_id', 'status', 'expiring', 'linked'), 'sort' => $sort, 'direction' => $direction],
            'options' => ExpenseOverview::options($tenant),
        ]);
    }

    public function options(Request $request, Tenant $tenant, string $catalog): JsonResponse
    {
        $query = $this->records($tenant, $catalog);
        if (in_array($catalog, ['contracts', 'projects'], true)) {
            $query->where(fn ($q) => $q->where('year', EconomicYearContext::year($tenant, $request))->orWhereNull('year'));
        }
        if ($search = $request->string('search')->trim()->toString()) {
            $query->where('name', 'like', '%'.$search.'%');
        }

        return response()->json(['records' => $query->orderBy('name')->limit(50)->get(['id', 'name'])->map(fn ($record) => ['id' => $record->id, 'name' => $record instanceof Contract ? $record->display_name : $record->name])]);
    }

    public function show(Request $request, Tenant $tenant, string $catalog, int $record): Response|\Symfony\Component\HttpFoundation\Response
    {
        $item = $this->records($tenant, $catalog)->findOrFail($record);
        if ($catalog !== 'vendors') {
            $item->load('costCenters.parent:id,name');
        }
        if ($item instanceof Contract) {
            $item->load('vendor:id,name');
            $item->setAttribute('has_period_expenses', $item->expenses()->whereNotNull('period_starts_on')->exists());
        }
        $year = EconomicYearContext::year($tenant, $request);
        if (($item instanceof Contract || $item instanceof Project) && $item->year !== null && $year !== $item->year) {
            return Inertia::location($request->url().'?'.http_build_query([...$request->query(), 'year' => $item->year]));
        }
        $history = $request->query('history') === '1';
        $field = match ($catalog) {
            'contracts' => 'contract_id', 'projects' => 'project_id', 'vendors' => 'vendor_id',
            default => abort(404),
        };
        $expenses = ExpenseOverview::economicQuery($tenant)->where($field, $item->id);
        $annual = (clone $expenses)->where('year', $year);
        if (! $history) {
            $expenses->where('year', $year);
        }
        $sort = in_array($request->input('sort'), ['title', 'allocated_amount', 'actual_amount', 'year', 'period_starts_on', 'updated_at'], true)
            ? $request->string('sort')->toString() : null;
        $direction = $request->input('direction') === 'desc' ? 'desc' : 'asc';
        // Keep KPI and chart totals tied to the selected year, independently of table filters.
        ExpenseOverview::search($expenses, $request->string('search')->toString());
        foreach (['vendor_id', 'contract_id', 'project_id'] as $relation) {
            if ($relation !== $field && $request->filled($relation)) {
                $request->input($relation) === 'none'
                    ? $expenses->whereNull($relation)
                    : $expenses->where($relation, $request->integer($relation));
            }
        }
        if ($sort !== null) {
            $expenses->orderBy($sort, $direction);
        } elseif ($item instanceof Contract) {
            $expenses->orderByRaw('period_starts_on IS NULL')->orderBy('period_starts_on')->orderBy('period_ends_on');
        }

        return Inertia::render('tenants/catalog-detail', [
            'tenant' => $tenant->only('id', 'name', 'slug'),
            'catalog' => $catalog,
            'record' => $item,
            'options' => ExpenseOverview::options($tenant),
            'year' => $year,
            'history' => $history,
            'expenseFilters' => [...$request->only('search', 'vendor_id', 'contract_id', 'project_id'), 'year' => $year, 'history' => $history ? '1' : '', 'sort' => $sort ?? ($item instanceof Contract ? 'period_starts_on' : 'year'), 'direction' => $sort !== null ? $direction : ($item instanceof Contract ? 'asc' : 'desc')],
            'totals' => ExpenseOverview::totals($annual),
            'analytics' => ExpenseAnalytics::kpis($tenant, Request::create($request->path(), 'GET', ['year' => $year, $field => $item->id])),
            'breakdown' => $item instanceof Contract && (clone $annual)->count() < 3 ? null : ExpenseOverview::breakdown($annual),
            'expenses' => $expenses->with(['vendor:id,name', 'contract:id,name', 'project:id,name', 'lines', 'costCenters.parent:id,name'])->orderByDesc('year')->orderBy('id')->paginate(25)->withQueryString(),
            'contracts' => $item instanceof Vendor ? $item->contracts()->forYear($year)->orderBy('name')->paginate(10, ['*'], 'contracts_page')->withQueryString() : null,
        ]);
    }

    /** @return array<string, mixed> */
    public function validated(Request $request, Tenant $tenant, string $catalog): array
    {
        $required = $request->isMethod('patch') ? ['sometimes', 'required'] : ['required'];
        $rules = [
            'tenant_id' => ['prohibited'],
            'initial_expense' => ['prohibited'],
            'name' => [...($catalog === 'contracts' ? ['nullable'] : $required), 'string', 'max:255'],
        ];
        $rules += match ($catalog) {
            'vendors' => [
                'vat_number' => ['nullable', 'string', 'max:50'],
                'email' => ['nullable', 'email', 'max:255'],
                'phone' => ['nullable', 'string', 'max:50'],
                'notes' => ['nullable', 'string', 'max:10000'],
            ],
            'contracts' => [
                'year' => $request->isMethod('post') ? ['sometimes', 'required', 'integer', 'between:2000,2100'] : ['missing'],
                'source_contract_id' => ['missing'],
                'vendor_id' => ['nullable', 'integer', Rule::exists('vendors', 'id')->where('tenant_id', $tenant->id)],
                'reference_amount' => ['nullable', 'regex:/^-?\d{1,12}(\.\d{1,2})?$/'],
                'starts_on' => ['nullable', 'date_format:Y-m-d'],
                'ends_on' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:starts_on'],
                'notes' => ['nullable', 'string', 'max:10000'],
            ],
            'projects' => [
                'year' => $request->isMethod('post') ? ['sometimes', 'required', 'integer', 'between:2000,2100'] : ['missing'],
                'source_project_id' => ['missing'],
                'description' => ['nullable', 'string', 'max:10000'],
                'status' => ['sometimes', 'nullable', 'string', Rule::exists('project_statuses', 'key')->where('tenant_id', $tenant->id)],
                'starts_on' => ['nullable', 'date_format:Y-m-d'],
                'ends_on' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:starts_on'],
            ],
            default => abort(404),
        };
        if (! $request->filled('starts_on')) {
            unset($rules['ends_on'][2]);
        }
        if ($catalog !== 'vendors') {
            $rules['cost_center_ids'] = ['sometimes', 'array', 'list'];
            $rules['cost_center_ids.*'] = ['required', 'integer', 'distinct', Rule::exists('cost_centers', 'id')->where('tenant_id', $tenant->id)];
        }

        $messages = [
            'name.required' => 'Inserisci il nome.',
            '*.exists' => 'Il collegamento selezionato non appartiene a questa azienda.',
            '*.regex' => 'Inserisci un importo con massimo due decimali.',
            'ends_on.after_or_equal' => 'La data finale deve essere uguale o successiva alla data iniziale.',
            'email.email' => 'Inserisci un indirizzo email valido.',
        ];
        if ($catalog === 'contracts' && $request->isMethod('post')) {
            $expenseFields = ['title', 'year', 'period_starts_on', 'period_ends_on', 'lines'];
            $rules['initial_expense'] = ['nullable', 'array:'.implode(',', $expenseFields)];
            if ($request->input('initial_expense') !== null) {
                foreach (ExpenseRequest::forTenant($tenant) as $field => $rule) {
                    if (in_array($field, $expenseFields, true) || str_starts_with($field, 'lines.')) {
                        $rules['initial_expense.'.$field] = array_map(fn ($part) => is_string($part) ? str_replace(':lines.', ':initial_expense.lines.', $part) : $part, $rule);
                    }
                }
                $rules['initial_expense.lines'] = ['required', 'min:1', ...array_diff($rules['initial_expense.lines'], ['sometimes'])];
                foreach ((new ExpenseRequest)->messages() as $field => $message) {
                    $messages['initial_expense.'.$field] = $message;
                }
                $messages['initial_expense.lines.required'] = 'Inserisci almeno una riga economica completa, anche di valore zero.';
            }
        }

        $data = $request->validate($rules, $messages);
        if (in_array($catalog, ['contracts', 'projects'], true) && $request->isMethod('post')) {
            $data['year'] ??= EconomicYearContext::year($tenant, $request);
        }

        return $data;
    }

    public function store(Request $request, Tenant $tenant, string $catalog): JsonResponse
    {
        $data = $this->validated($request, $tenant, $catalog);
        $record = DB::transaction(function () use ($tenant, $catalog, $data) {
            $ids = $data['cost_center_ids'] ?? [];
            $initialExpense = $data['initial_expense'] ?? null;
            unset($data['cost_center_ids'], $data['initial_expense']);
            $record = $this->records($tenant, $catalog)->create($data);
            if ($record instanceof Contract || $record instanceof Project) {
                $record->costCenters()->sync($ids);
                $record->load('costCenters.parent:id,name');
            }
            if ($record instanceof Contract && $initialExpense !== null) {
                try {
                    app(ExpenseWriter::class)->create($tenant, [
                        ...$initialExpense,
                        'contract_id' => $record->id,
                        'contract_entry' => true,
                        'vendor_id' => $record->vendor_id,
                        'cost_center_ids' => $ids,
                    ]);
                } catch (ValidationException $error) {
                    $errors = [];
                    foreach ($error->errors() as $field => $messages) {
                        $errors['initial_expense.'.$field] = $messages;
                    }
                    throw ValidationException::withMessages($errors);
                }
            }

            return $record;
        });

        return response()->json(['record' => $record], 201);
    }

    public function update(Request $request, Tenant $tenant, string $catalog, int $record): JsonResponse
    {
        $item = $this->records($tenant, $catalog)->findOrFail($record);
        if ($request->isMethod('patch') && ($item instanceof Contract || $item instanceof Project) &&
            ($request->exists('starts_on') || $request->exists('ends_on'))) {
            $request->mergeIfMissing([
                'starts_on' => $item->getRawOriginal('starts_on'),
                'ends_on' => $item->getRawOriginal('ends_on'),
            ]);
        }
        if (($item instanceof Contract || $item instanceof Project) && $item->year === null) {
            throw ValidationException::withMessages(['year' => 'Elemento storico senza anno: occorre una classificazione esplicita prima della modifica.']);
        }
        $data = $this->validated($request, $tenant, $catalog);
        DB::transaction(function () use ($item, $data) {
            $ids = $data['cost_center_ids'] ?? null;
            unset($data['cost_center_ids']);
            $item->update($data);
            if (($item instanceof Contract || $item instanceof Project) && $ids !== null) {
                $item->costCenters()->sync($ids);
            }
        });
        $item->refresh();
        if ($item instanceof Contract || $item instanceof Project) {
            $item->load('costCenters.parent:id,name');
        }

        return response()->json(['record' => $item]);
    }

    public function destroy(Tenant $tenant, string $catalog, int $record, AttachmentFiles $files): JsonResponse
    {
        $response = DB::transaction(function () use ($tenant, $catalog, $record, $files): JsonResponse {
            $item = $this->records($tenant, $catalog)->lockForUpdate()->findOrFail($record);
            if ($item instanceof Contract && $tenant->contracts()->where('source_contract_id', $item->id)->exists()) {
                return response()->json(['message' => 'Eliminazione bloccata: il contratto è sorgente di copie annuali.'], 409);
            }
            if ($item instanceof Project && $tenant->projects()->where('source_project_id', $item->id)->exists()) {
                return response()->json(['message' => 'Eliminazione bloccata: il progetto è sorgente di copie annuali.'], 409);
            }
            $expenseCount = $item->expenses()->count();
            $contractCount = $item instanceof Vendor ? $item->contracts()->count() : 0;
            if ($expenseCount || $contractCount) {
                return response()->json(['message' => "Eliminazione bloccata: sono collegati {$expenseCount} spese e {$contractCount} contratti. Rimuovi prima questi collegamenti."], 409);
            }
            if ($item instanceof Contract || $item instanceof Project) {
                $files->delete($item);
            } else {
                abort_unless($item->delete(), 409);
            }

            return response()->json(['message' => 'Elemento eliminato.']);
        });

        return $response->isSuccessful() ? $response->setData($files->result('Elemento eliminato.')) : $response;
    }
}
