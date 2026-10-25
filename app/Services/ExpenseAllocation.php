<?php

namespace App\Services;

use App\Http\Controllers\Tenant\BudgetController;
use App\Models\Contract;
use App\Models\Expense;
use App\Models\Tenant;
use App\Support\ExpenseOverview;
use App\Support\ExpensePeriods;
use App\Support\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class ExpenseAllocation
{
    /** @param array<string, mixed> $data */
    public function needsBudgetReassignment(Tenant $tenant, Expense $expense, array $data): bool
    {
        $draft = clone $expense;
        $draft->fill(array_intersect_key($data, ['contract_id' => true, 'project_id' => true]));
        if (! $draft->isDirty(['contract_id', 'project_id']) ||
            (($draft->contract_id !== null ? 1 : 0) + ($draft->project_id !== null ? 1 : 0) !== 1)) {
            return false;
        }
        $direct = $tenant->budgetEntries()->where('expense_id', $expense->id)->exists();
        if ($direct) {
            return $expense->contract_id === null && $expense->project_id === null;
        }
        if ($expense->contract_id !== null && $expense->project_id !== null) {
            return false;
        }
        app(ExpenseWriter::class)->persist($draft, $data, write: false);
        $sourceType = $expense->contract_id !== null ? 'contract' : ($expense->project_id !== null ? 'project' : 'expense');
        $targetType = $draft->contract_id !== null ? 'contract' : 'project';
        $beforeYears = ExpenseOverview::economicQuery($tenant)->where('id', $expense->id)->pluck('year');
        $afterYears = ExpenseOverview::draftRows($draft)->pluck('year');
        $before = $tenant->budgetEntries()->where($sourceType.'_id', $sourceType === 'expense' ? $expense->id : $expense->getAttribute($sourceType.'_id'))
            ->whereHas('budgetYear', fn ($query) => $query->whereIn('year', $beforeYears))->orderBy('budget_year_id')->pluck('budget_year_id')->all();
        $after = $tenant->budgetEntries()->where($targetType.'_id', $draft->getAttribute($targetType.'_id'))
            ->whereHas('budgetYear', fn ($query) => $query->whereIn('year', $afterYears))->orderBy('budget_year_id')->pluck('budget_year_id')->all();

        return $before !== $after;
    }

    /** @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    public function budgetPreview(Tenant $tenant, Expense $expense, array $data): array
    {
        $type = isset($data['contract_id']) ? 'contract' : 'project';
        $target = $tenant->{$type.'s'}()->whereKey($data[$type.'_id'] ?? 0)->first();
        if ($target === null || ! $this->needsBudgetReassignment($tenant, $expense, $data)) {
            throw ValidationException::withMessages(['budget' => 'Scegli un solo contratto o progetto che modifichi l’inclusione della spesa nel Budget. Rimuovi esplicitamente eventuali collegamenti precedenti.']);
        }
        $expense->load(['lines', 'costCenters']);
        $direct = $tenant->budgetEntries()->where('expense_id', $expense->id)->with('budgetYear')->orderBy('id')->get();
        $beforeRows = ExpenseOverview::economicQuery($tenant)->where('id', $expense->id)->get()->keyBy('year');
        $draft = clone $expense;
        $problem = null;
        try {
            // Prepare the full form without bypassing the normal writer's Budget guard.
            app(ExpenseWriter::class)->persist($draft, array_diff_key($data, ['contract_id' => true, 'project_id' => true, 'contract_entry' => true]), write: false);
            $draft->fill(array_intersect_key($data, ['contract_id' => true, 'project_id' => true]));
            ExpensePeriods::validate($draft);
            $afterRows = ExpenseOverview::draftRows($draft)->keyBy('year');
            if ($target->year === null || $afterRows->contains(fn ($row) => $row->year !== $target->year)) {
                $problem = 'Gli anni economici della spesa non coincidono con l’anno del contenitore. Correggi gli anni o separa manualmente le quote prima di collegarla.';
            }
            foreach (['allocated', 'actual'] as $metric) {
                if ($expense->lines->contains(fn ($line) => $line->year !== null)) {
                    $parts = $expense->lines->where('type', $metric);
                    $total = $parts->isEmpty() ? null : Money::decimal($parts->sum(fn ($line) => Money::cents((string) $line->total)));
                    if ($expense->{$metric.'_amount'} !== $total) {
                        $problem = 'Gli importi storici non corrispondono alle righe. Verifica e correggi manualmente la spesa prima di collegarla.';
                    }
                }
            }
        } catch (ValidationException $error) {
            $problem = collect($error->errors())->flatten()->first();
            $afterRows = collect();
        }
        $years = $beforeRows->keys()->merge($afterRows->keys())->merge($direct->map(fn ($entry) => $entry->budgetYear->year))
            ->push($target->year)->filter()->unique()->sort()->values();
        $budget = app(AnnualBudget::class);
        $states = [];
        $rows = [];
        $addProblem = null;
        $automatic = true;
        foreach ($years as $year) {
            $budgetYear = $tenant->budgetYears()->where('year', $year)->first();
            $before = $budgetYear === null ? null : $budget->snapshot($tenant, $budgetYear);
            $after = $budgetYear === null || $problem !== null ? null : $budget->snapshot($tenant, $budgetYear, reassignedExpense: $draft);
            /** @var array<int, array<string, mixed>> $budgetEntries */
            $budgetEntries = $before['entries'] ?? [];
            $destination = collect($budgetEntries)->first(fn ($entry) => $entry['type'] === $type && $entry['source_id'] === $target->id);
            if (($before['warnings'] ?? []) !== []) {
                $problem = 'Il Budget contiene collegamenti storici incompatibili. Correggili manualmente prima di confermare.';
            }
            $withTarget = $after;
            $directYear = $direct->contains(fn ($entry) => $entry->budgetYear->year === $year);
            $includedBefore = isset($before['owners'][$expense->id]);
            if ($includedBefore !== isset($after['owners'][$expense->id])) {
                $automatic = false;
            }
            if (($directYear || $includedBefore) && $destination === null && $budgetYear !== null) {
                $automatic = false;
                try {
                    AnnualBudget::validateSource($tenant, $budgetYear, $target);
                    if ($problem === null) {
                        $withTarget = $budget->snapshot($tenant, $budgetYear, reassignedExpense: $draft, addedSource: $target);
                    }
                } catch (ValidationException $error) {
                    $addProblem = 'Budget '.$year.': '.collect($error->errors())->flatten()->first();
                    $withTarget = null;
                }
            }
            $states[] = [$budgetYear?->getAttributes(), $before, $withTarget];
            $afterChoices = ['add' => $withTarget['totals'] ?? null, 'link' => $after['totals'] ?? null];
            $difference = [];
            foreach ($afterChoices as $choice => $totals) {
                foreach (['allocated', 'actual', 'variance'] as $metric) {
                    $old = $before['totals'][$metric] ?? null;
                    $new = $totals[$metric] ?? null;
                    $difference[$choice][$metric] = $before === null || $totals === null || ($old === null && $new === null)
                        ? null : Money::decimal(Money::cents($new ?? '0.00') - Money::cents($old ?? '0.00'));
                }
            }
            $values = fn (?Expense $row) => $row === null ? null : ['allocated' => $row->allocated_amount, 'actual' => $row->actual_amount, 'variance' => $row->variance];
            $rows[] = [
                'year' => $year, 'budget_id' => $budgetYear?->id,
                'direct_entries' => $direct->filter(fn ($entry) => $entry->budgetYear->year === $year)->map(fn ($entry) => $entry->only(['id']))->values()->all(),
                'destination' => $destination === null ? 'missing' : 'present',
                'expense_before' => $values($beforeRows->get($year)), 'expense_after' => $values($afterRows->get($year)),
                'budget_before' => $before['totals'] ?? null, 'budget_after' => $afterChoices, 'difference' => $difference,
            ];
        }

        return [
            'expense' => $expense->only(['id', 'title']),
            'target' => ['type' => $type, 'id' => $target->id, 'name' => $target instanceof Contract ? $target->display_name : $target->name, 'year' => $target->year],
            'years' => $rows, 'valid' => $problem === null, 'problem' => $problem,
            'automatic' => $automatic && $problem === null,
            'choices' => [
                'add' => ['valid' => $problem === null && $addProblem === null, 'problem' => $problem ?? $addProblem],
                'link' => ['valid' => $problem === null, 'problem' => $problem],
            ],
            'token' => hash_hmac('sha256', json_encode([$data, $expense->getAttributes(), $expense->lines->toArray(), $expense->costCenters->toArray(), $direct->toArray(), $target->getAttributes(), $states], JSON_THROW_ON_ERROR), (string) config('app.key')),
        ];
    }

    /** @param array<string, mixed> $data */
    public function reassignBudget(Tenant $tenant, Expense $expense, array $data, ?string $token = null, string $choice = 'link'): ?Expense
    {
        return DB::transaction(function () use ($tenant, $expense, $data, $token, $choice): ?Expense {
            Tenant::whereKey($tenant->id)->lockForUpdate()->firstOrFail();
            $expense = $tenant->expenses()->whereKey($expense->id)->lockForUpdate()->firstOrFail();
            ExpensePeriods::lockContracts($tenant, [$expense->contract_id, $data['contract_id'] ?? null]);
            $tenant->projects()->whereIn('id', array_filter([$expense->project_id, $data['project_id'] ?? null]))->orderBy('id')->lockForUpdate()->get();
            $years = $tenant->budgetYears()->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            $entries = $tenant->budgetEntries()->where('expense_id', $expense->id)->orderBy('id')->lockForUpdate()->get();
            abort_unless($this->needsBudgetReassignment($tenant, $expense, $data), 409, 'I collegamenti sono cambiati. Ricarica l’anteprima prima di confermare.');
            $preview = $this->budgetPreview($tenant, $expense, $data);
            if ($token === null && ! $preview['automatic']) {
                return null;
            }
            abort_unless($token === null || hash_equals($preview['token'], $token), 409, 'La spesa, la destinazione o il Budget sono cambiati. Ricarica l’anteprima prima di confermare.');
            if (! ($preview['choices'][$choice]['valid'] ?? false)) {
                throw ValidationException::withMessages(['budget' => $preview['choices'][$choice]['problem'] ?? 'Scegli come collegare la spesa.']);
            }
            foreach ($entries as $entry) {
                AnnualBudget::removeEntry($years->get($entry->budget_year_id), $entry);
            }
            app(ExpenseWriter::class)->persist($expense, $data);
            if ($choice === 'add') {
                foreach ($preview['years'] as $row) {
                    if ($row['budget_id'] !== null && $row['destination'] === 'missing' && $row['budget_after']['add'] !== $row['budget_after']['link']) {
                        app(BudgetController::class)->add($tenant, $years->get($row['budget_id']), ['type' => $preview['target']['type'], 'source_id' => $preview['target']['id'], 'restore' => true], 0);
                    }
                }
            }

            return $expense->refresh();
        });
    }

    /** @return array<string, mixed> */
    public function preview(Tenant $tenant, Expense $expense): array
    {
        $expense->load(['lines', 'contract', 'project']);
        $type = $expense->contract_id !== null ? 'contract' : ($expense->project_id !== null ? 'project' : null);
        $container = $type === null ? null : $expense->{$type};
        $years = ExpenseOverview::economicQuery($tenant)->where('id', $expense->id)->orderBy('year')->get();
        $budgets = $tenant->budgetEntries()->where('expense_id', $expense->id)->with('budgetYear')->get();

        return [
            'ambiguous' => $expense->contract_id !== null && $expense->project_id !== null,
            'type' => $type, 'container' => $container?->only(['id', 'name', 'year']),
            'conflicts' => $type === null || ($expense->contract_id !== null && $expense->project_id !== null) ? [] : $years->where('year', '!==', $container?->year)->map(fn ($row) => [
                'year' => $row->year, 'allocated' => $row->allocated_amount, 'actual' => $row->actual_amount,
                'split' => $years->count() > 1,
            ])->values()->all(),
            'budgets' => $budgets->map(fn ($entry) => ['year' => $entry->budgetYear->year, 'url' => '/t/'.$tenant->slug.'/budget?year='.$entry->budgetYear->year])->all(),
            'token' => hash_hmac('sha256', json_encode([$expense->getAttributes(), $expense->lines->toArray(), $container?->getAttributes(), $budgets->toArray()], JSON_THROW_ON_ERROR), (string) config('app.key')),
        ];
    }

    /** @param array<string, mixed> $data */
    public function resolve(Tenant $tenant, Expense $expense, array $data): Expense
    {
        return DB::transaction(function () use ($tenant, $expense, $data): Expense {
            $data['year'] = (int) $data['year'];
            Tenant::whereKey($tenant->id)->lockForUpdate()->firstOrFail();
            $expense = $tenant->expenses()->whereKey($expense->id)->lockForUpdate()->firstOrFail();
            $preview = $this->preview($tenant, $expense);
            if (! hash_equals($preview['token'], $data['token'])) {
                throw ValidationException::withMessages(['allocation' => 'La spesa è cambiata. Ricarica la pagina e verifica gli importi prima di confermare.']);
            }
            /** @var list<array{year: int, split: bool}> $conflicts */
            $conflicts = $preview['conflicts'];
            $conflict = collect($conflicts)->firstWhere('year', $data['year']);
            if ($conflict === null || $preview['budgets'] !== []) {
                throw ValidationException::withMessages(['allocation' => 'Risolvi prima i collegamenti incompatibili e rimuovi le eventuali voci Budget dirette della spesa.']);
            }
            $type = $preview['type'];
            $lines = $expense->lines;
            $selected = $lines->filter(fn ($line) => ($line->year ?? $expense->year) === $data['year']);
            if ($data['action'] === 'year') {
                $year = $preview['container']['year'];
                if ($year === null || $expense->source_expense_id !== null) {
                    throw ValidationException::withMessages(['allocation' => 'Classifica prima il contenitore senza anno. Per una spesa importata conserva l’anno e scegli il contenitore corretto.']);
                }
                $expense->lines()->whereIn('id', $selected->modelKeys())->update(['year' => $year]);
                if ($expense->lines()->get()->every(fn ($line) => ($line->year ?? $expense->year) === $year)) {
                    app(ExpenseWriter::class)->persist($expense, ['year' => $year]);
                }

                return $expense->refresh();
            }
            $target = $tenant->{$type.'s'}()->whereKey($data['target_id'] ?? 0)->where('year', $data['year'])->lockForUpdate()->first();
            if ($target === null) {
                throw ValidationException::withMessages(['target_id' => 'Seleziona un contenitore dell’anno della spesa, appartenente a questa azienda.']);
            }
            if (! $conflict['split']) {
                app(ExpenseWriter::class)->persist($expense, ['contract_id' => null, 'project_id' => null, $type.'_id' => $target->id]);

                return $expense->refresh();
            }
            // A split must account for every recorded cent before moving any line.
            foreach (['allocated', 'actual'] as $metric) {
                $parts = $lines->where('type', $metric);
                $total = $parts->isEmpty() ? null : Money::decimal($parts->sum(fn ($line) => Money::cents((string) $line->total)));
                if ($expense->{$metric.'_amount'} !== $total) {
                    throw ValidationException::withMessages(['allocation' => 'Gli importi storici non corrispondono alle righe. Verifica la spesa prima di separare gli anni.']);
                }
            }
            $copy = app(ExpenseWriter::class)->create($tenant, [
                ...$expense->only(['title', 'notes', 'vendor_id', 'period_starts_on', 'period_ends_on']),
                'year' => $data['year'], $type.'_id' => $target->id,
                'cost_center_ids' => $expense->costCenters()->allRelatedIds()->all(),
            ]);
            $expense->lines()->whereIn('id', $selected->modelKeys())->update(['expense_id' => $copy->id, 'year' => $data['year']]);
            foreach ([$expense, $copy] as $record) {
                $remaining = $record->lines()->get();
                foreach (['allocated', 'actual'] as $metric) {
                    $parts = $remaining->where('type', $metric);
                    $record->{$metric.'_amount'} = $parts->isEmpty() ? null : Money::decimal($parts->sum(fn ($line) => Money::cents((string) $line->total)));
                }
                $record->save();
            }

            return $copy;
        });
    }
}
