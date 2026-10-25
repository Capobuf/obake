<?php

namespace App\Http\Controllers\Tenant;

use App\Http\Controllers\Controller;
use App\Http\Requests\ExpenseRequest;
use App\Models\Expense;
use App\Models\Tenant;
use App\Services\AttachmentFiles;
use App\Services\ExpenseAllocation;
use App\Services\ExpenseWriter;
use App\Support\ExpenseAnalytics;
use App\Support\ExpenseOverview;
use App\Support\ExpensePeriods;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

class ExpenseController extends Controller
{
    public function options(Request $request, Tenant $tenant): JsonResponse
    {
        $data = $request->validate([
            'search' => ['nullable', 'string', 'max:255'],
            'exclude_project_id' => ['nullable', 'integer', Rule::exists('projects', 'id')->where('tenant_id', $tenant->id)],
        ]);
        $query = $tenant->expenses()->with('project:id,name');
        if (isset($data['exclude_project_id'])) {
            $query->whereNull('contract_id')->whereNotIn('id', $tenant->budgetEntries()->whereNotNull('expense_id')->select('expense_id'));
            $query->where(fn ($query) => $query->whereNull('project_id')->orWhere('project_id', '!=', $data['exclude_project_id']));
        }
        if ($search = trim($data['search'] ?? '')) {
            $query->where('title', 'like', '%'.$search.'%');
        }

        return response()->json(['records' => $query->orderBy('title')->orderBy('id')->limit(50)->get()->map(fn (Expense $expense) => [
            'id' => $expense->id,
            'name' => $expense->title.' · '.$expense->year.' · '.($expense->project->name ?? 'Senza progetto'),
        ])]);
    }

    public function index(Request $request, Tenant $tenant): Response
    {
        return Inertia::render('tenants/expenses', [
            ...ExpenseOverview::page($tenant, $request),
            'analytics' => ExpenseAnalytics::kpis($tenant, $request),
        ]);
    }

    public function show(Tenant $tenant, Expense $expense): Response
    {
        return Inertia::render('tenants/expense', [
            'tenant' => $tenant->only('id', 'name', 'slug'),
            'expense' => $expense->load(['vendor:id,name', 'contract:id,name', 'project:id,name', 'lines', 'costCenters.parent:id,name']),
            'allocation' => app(ExpenseAllocation::class)->preview($tenant, $expense),
            'options' => ExpenseOverview::options($tenant),
        ]);
    }

    public function store(ExpenseRequest $request, Tenant $tenant): JsonResponse
    {
        $expense = DB::transaction(function () use ($tenant, $request): Expense {
            $data = $request->validated();
            $budgetId = $data['budget_year_id'] ?? null;
            unset($data['budget_year_id']);
            $year = $budgetId !== null ? $tenant->budgetYears()->whereKey($budgetId)->lockForUpdate()->firstOrFail() : null;
            if ($year !== null && $year->year !== (int) $data['year']) {
                throw ValidationException::withMessages(['year' => 'L’anno della spesa deve coincidere con il Budget di partenza.']);
            }
            $expense = app(ExpenseWriter::class)->create($tenant, $data);
            if ($year !== null) {
                if ($expense->year !== $year->year) {
                    throw ValidationException::withMessages(['year' => 'L’anno delle righe deve coincidere con il Budget di partenza.']);
                }
                app(BudgetController::class)->add($tenant, $year, ['type' => 'expense', 'source_id' => $expense->id], 0);
            }

            return $expense;
        });

        return response()->json(['warnings' => array_filter([ExpensePeriods::overlapWarning($expense)]), 'record' => $expense->load(['vendor:id,name', 'contract:id,name', 'project:id,name', 'lines', 'costCenters.parent:id,name'])], 201);
    }

    public function allocation(Request $request, Tenant $tenant, Expense $expense, ExpenseAllocation $allocation): JsonResponse
    {
        $data = $request->validate([
            'action' => ['required', Rule::in(['year', 'container'])],
            'year' => ['required', 'integer', 'between:2000,2100'],
            'target_id' => ['required_if:action,container', 'nullable', 'integer'],
            'token' => ['required', 'string'], 'confirmed' => ['required', 'accepted'],
        ]);
        $record = $allocation->resolve($tenant, $expense, $data);

        return response()->json(['record' => $record, 'message' => 'Imputazione aggiornata. Verifica le voci da includere nel Budget.']);
    }

    public function update(ExpenseRequest $request, Tenant $tenant, Expense $expense): JsonResponse
    {
        $record = DB::transaction(function () use ($request, $tenant, $expense): ?Expense {
            Tenant::whereKey($tenant->id)->lockForUpdate()->firstOrFail();
            $locked = $tenant->expenses()->whereKey($expense->id)->lockForUpdate()->firstOrFail();
            $allocation = app(ExpenseAllocation::class);
            if ($allocation->needsBudgetReassignment($tenant, $locked, $request->validated())) {
                return $allocation->reassignBudget($tenant, $locked, $request->validated());
            }
            ExpensePeriods::lockContracts($tenant, [$locked->contract_id, $request->validated('contract_id')]);
            app(ExpenseWriter::class)->persist($locked, $request->validated());

            return $locked;
        });
        if ($record === null) {
            return response()->json(['code' => 'budget_reassignment_required', 'message' => 'Verifica come cambia l’inclusione della spesa nel Budget prima di confermare.'], 422);
        }

        return response()->json(['warnings' => array_filter([ExpensePeriods::overlapWarning($record)]), 'record' => $record->load(['vendor:id,name', 'contract:id,name', 'project:id,name', 'lines', 'costCenters.parent:id,name'])]);
    }

    public function budgetPreview(ExpenseRequest $request, Tenant $tenant, Expense $expense, ExpenseAllocation $allocation): JsonResponse
    {
        return DB::transaction(function () use ($request, $tenant, $expense, $allocation): JsonResponse {
            Tenant::whereKey($tenant->id)->lockForUpdate()->firstOrFail();

            return response()->json($allocation->budgetPreview($tenant, $expense->fresh(), $request->validated()));
        });
    }

    public function reassignBudget(ExpenseRequest $request, Tenant $tenant, Expense $expense, ExpenseAllocation $allocation): JsonResponse
    {
        $confirmation = $request->validate(['token' => ['required', 'string'], 'confirmed' => ['required', 'accepted'], 'choice' => ['required', Rule::in(['add', 'link'])]]);
        $record = $allocation->reassignBudget($tenant, $expense, $request->validated(), $confirmation['token'], $confirmation['choice']);

        return response()->json(['record' => $record?->load(['vendor:id,name', 'contract:id,name', 'project:id,name', 'lines', 'costCenters.parent:id,name'])]);
    }

    public function destroy(Tenant $tenant, Expense $expense, AttachmentFiles $files): JsonResponse
    {
        DB::transaction(function () use ($tenant, $expense, $files): void {
            $locked = $tenant->expenses()->whereKey($expense->id)->lockForUpdate()->firstOrFail();
            ExpensePeriods::lockContracts($tenant, [$locked->contract_id]);
            $files->delete($locked);
        });

        return response()->json($files->result('Spesa eliminata.'));
    }

    public function destroyBatch(Request $request, Tenant $tenant, AttachmentFiles $files): JsonResponse
    {
        $data = $request->validate([
            'tenant_id' => ['prohibited'],
            'ids' => ['required', 'array', 'min:1', 'max:50'],
            'ids.*' => ['required', 'integer', 'distinct', Rule::exists('expenses', 'id')->where('tenant_id', $tenant->id)],
        ], [
            'ids.*.exists' => 'Una spesa non è disponibile in questa azienda. Nessuna spesa eliminata.',
        ]);

        DB::transaction(function () use ($tenant, $data, $files): void {
            $records = $tenant->expenses()->whereIn('id', $data['ids'])->orderBy('id')->lockForUpdate()->get();
            abort_unless($records->count() === count($data['ids']), 409, 'La selezione è cambiata. Nessuna spesa eliminata.');
            ExpensePeriods::lockContracts($tenant, $records->pluck('contract_id')->all());

            foreach ($records as $record) {
                $files->delete($record);
            }
        });

        return response()->json($files->result('Spese selezionate eliminate.'));
    }

    public function batch(Request $request, Tenant $tenant): JsonResponse
    {
        $fields = array_filter(array_keys(ExpenseRequest::forTenant($tenant, true)), fn (string $field) => ! str_contains($field, '.'));
        $rules = ['tenant_id' => 'prohibited', 'updates' => ['required', 'array', 'min:1', 'max:500'], 'updates.*' => ['required', 'array:'.implode(',', ['id', ...$fields])]];
        $rules['updates.*.id'] = ['required', 'integer', 'distinct', Rule::exists('expenses', 'id')->where('tenant_id', $tenant->id)];
        foreach (ExpenseRequest::forTenant($tenant, true) as $field => $rule) {
            $rules['updates.*.'.$field] = array_map(fn ($part) => is_string($part) ? str_replace(':lines.', ':updates.*.lines.', $part) : $part, $rule);
        }
        $data = Validator::make($request->all(), $rules, [
            '*.exists' => 'Una riga o un collegamento non appartiene a questa azienda. Nessuna modifica salvata.',
            '*.regex' => 'Importo non valido: usa un valore con massimo due decimali.',
            '*.required' => 'La descrizione e l’anno non possono essere vuoti.',
        ])->validate();

        $warnings = DB::transaction(function () use ($tenant, $data): array {
            Tenant::whereKey($tenant->id)->lockForUpdate()->firstOrFail();
            $records = $tenant->expenses()->whereIn('id', array_column($data['updates'], 'id'))->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            ExpensePeriods::lockContracts($tenant, [...$records->pluck('contract_id')->all(), ...array_column($data['updates'], 'contract_id')]);
            foreach ($data['updates'] as $index => $update) {
                $record = $records->get($update['id']);
                abort_unless($record !== null, 404);
                unset($update['id']);
                try {
                    if (app(ExpenseAllocation::class)->needsBudgetReassignment($tenant, $record, $update)) {
                        throw ValidationException::withMessages(['budget' => 'Modifica il collegamento di questa spesa singolarmente per verificare l’anteprima del Budget.']);
                    }
                    app(ExpenseWriter::class)->persist($record, $update);
                } catch (ValidationException $error) {
                    $errors = [];
                    foreach ($error->errors() as $field => $messages) {
                        $errors["updates.{$index}.{$field}"] = $messages;
                    }
                    throw ValidationException::withMessages($errors);
                }
            }

            return $records->map(fn ($record) => ExpensePeriods::overlapWarning($record))->filter()->values()->all();
        });

        return response()->json(['message' => 'Modifiche salvate.', 'warnings' => $warnings]);
    }
}
