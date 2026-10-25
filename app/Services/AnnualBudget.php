<?php

namespace App\Services;

use App\Models\BudgetEntry;
use App\Models\BudgetYear;
use App\Models\Contract;
use App\Models\Expense;
use App\Models\Project;
use App\Models\Tenant;
use App\Support\ExpenseOverview;
use App\Support\Money;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

class AnnualBudget
{
    public const TYPES = ['contract', 'project', 'expense'];

    /** Convert old excluded references to explicit removals without changing their sources.
     * @param  array<int, array<string, mixed>>  $entries
     * @param  array<int, array<string, mixed>>  $years
     * @return list<array<string, mixed>>
     */
    public static function normalizeLegacyEntries(array $entries, array &$years): array
    {
        $yearsById = array_column($years, null, 'id');
        foreach ($entries as $entry) {
            if (! in_array($entry['included'], [false, 0, '0', true, 1, '1'], true)
                || ! in_array($entry['type'], self::TYPES, true)
                || count(array_filter([$entry['contract_id'], $entry['project_id'], $entry['expense_id']], fn ($id) => $id !== null)) !== 1
                || $entry[$entry['type'].'_id'] === null
                || ! isset($yearsById[$entry['budget_year_id']])
                || $yearsById[$entry['budget_year_id']]['tenant_id'] !== $entry['tenant_id']) {
                throw ValidationException::withMessages(['budget' => 'Riferimento Budget storico incoerente: correggilo prima di convertire o ripristinare i dati.']);
            }
            if (! $entry['included']) {
                $year = &$yearsById[$entry['budget_year_id']];
                $sources = json_decode($year['dismissed_sources'] ?? '[]', true, flags: JSON_THROW_ON_ERROR);
                $year['dismissed_sources'] = json_encode(array_values(array_unique([...$sources, $entry['type'].':'.$entry[$entry['type'].'_id']])), JSON_THROW_ON_ERROR);
                unset($year);
            }
        }
        $years = array_values($yearsById);

        return array_values(array_filter($entries, fn ($entry) => (bool) $entry['included']));
    }

    public static function removeEntry(BudgetYear $year, BudgetEntry $entry): void
    {
        $year->dismissed_sources = array_values(array_unique([...($year->dismissed_sources ?? []), $entry->type.':'.$entry->getAttribute($entry->type.'_id')]));
        $year->save();
        $entry->delete();
    }

    public static function validateSource(Tenant $tenant, BudgetYear $year, Contract|Project|Expense $source): void
    {
        if ($source instanceof Expense) {
            if ($source->contract_id !== null || $source->project_id !== null) {
                throw ValidationException::withMessages(['entries' => 'Le spese singole devono essere autonome. Inserisci nel Budget il contratto o progetto della spesa.']);
            }
            if (! ExpenseOverview::economicQuery($tenant)->where('id', $source->id)->where('year', $year->year)->exists()) {
                throw ValidationException::withMessages(['entries' => 'La spesa non ha dati economici nell’anno del Budget.']);
            }
        } elseif ($source->year !== $year->year) {
            throw ValidationException::withMessages(['entries' => 'Il contenitore deve appartenere all’anno del Budget. Correggi l’anno della spesa o scegli un contenitore di questo anno.']);
        } elseif ($source->expenses()->where(function ($query) use ($year) {
            $query->where(fn ($q) => $q->whereNotNull('contract_id')->whereNotNull('project_id'))
                ->orWhereIn('id', $year->entries()->where('type', 'expense')->select('expense_id'));
        })->exists()) {
            throw ValidationException::withMessages(['entries' => 'Il contenitore ha spese con collegamenti storici incompatibili o voci Budget dirette. Correggi i collegamenti e rimuovi le sole voci dirette prima di includerlo.']);
        }
    }

    /** @return Collection<int, Expense> */
    private function expenses(Tenant $tenant, int $year): Collection
    {
        return ExpenseOverview::economicQuery($tenant)->where('year', $year)
            ->with(['vendor:id,name', 'contract:id,name,year', 'project:id,name,year', 'costCenters.parent:id,name',
                'lines' => fn ($query) => $query->where(fn ($query) => $query->where('expense_lines.year', $year)
                    ->orWhere(fn ($query) => $query->whereNull('expense_lines.year')->whereIn('expense_id', $tenant->expenses()->where('year', $year)->select('id')))),
            ])
            ->orderBy('title')->orderBy('id')->get();
    }

    /** @param list<int>|null $entryIds
     * @return array<string, mixed>
     */
    public function snapshot(Tenant $tenant, BudgetYear $year, ?array $entryIds = null, ?Expense $reassignedExpense = null, Contract|Project|null $addedSource = null): array
    {
        $entries = $tenant->budgetEntries()->where('budget_year_id', $year->id)
            ->with(['contract.vendor:id,name', 'project', 'expense.vendor:id,name', 'costCenter.parent:id,name'])
            ->orderBy('position')->orderBy('id')->get();
        $expenses = $this->expenses($tenant, $year->year);
        if ($reassignedExpense !== null) {
            $entries = $entries->reject(fn ($entry) => $entry->expense_id === $reassignedExpense->id);
            $expenses = $expenses->reject(fn ($expense) => $expense->id === $reassignedExpense->id)
                ->concat(ExpenseOverview::draftRows($reassignedExpense)->where('year', $year->year));
        }
        if ($addedSource !== null) {
            $type = $addedSource instanceof Contract ? 'contract' : 'project';
            $entry = new BudgetEntry(['tenant_id' => $tenant->id, 'type' => $type, $type.'_id' => $addedSource->id]);
            $entry->id = max(1, (int) $entries->max('id') + 1);
            $entry->setRelation($type, $addedSource);
            $entries->push($entry);
        }
        $owners = [];
        $warnings = [];
        foreach ($expenses as $expense) {
            $type = $expense->contract_id !== null ? 'contract' : ($expense->project_id !== null ? 'project' : 'expense');
            $id = $type === 'expense' ? $expense->id : $expense->getAttribute($type.'_id');
            $legacy = ($expense->contract_id !== null && $expense->project_id !== null)
                || ($type !== 'expense' && $entries->contains(fn ($entry) => $entry->type === 'expense' && $entry->expense_id === $expense->id));
            if ($legacy) {
                $warnings[] = "Spesa #{$expense->id}: collegamenti storici incompatibili. I conteggi storici sono conservati; correggi esplicitamente i collegamenti e le voci Budget.";
                // Restored historical conflicts retain their former attribution until explicitly resolved.
                foreach (self::TYPES as $legacyType) {
                    $owner = $entries->first(fn ($entry) => $entry->type === $legacyType && $this->matches($legacyType, (int) $entry->getAttribute($legacyType.'_id'), $expense));
                    if ($owner !== null) {
                        $owners[$expense->id] = $owner->id;
                        break;
                    }
                }
            } else {
                $owner = $entries->first(fn ($entry) => $entry->type === $type && $entry->getAttribute($type.'_id') === $id);
                if ($owner !== null) {
                    $owners[$expense->id] = $owner->id;
                }
            }
        }
        $names = $entries->mapWithKeys(fn ($entry) => [$entry->id => $entry->{$entry->type}?->getAttribute($entry->type === 'expense' ? 'title' : ($entry->type === 'contract' ? 'display_name' : 'name'))])->all();
        /** @var array<int, array<string, mixed>> $rows */
        $rows = [];
        foreach ($entries as $entry) {
            $source = $entry->{$entry->type};
            $linked = $expenses->filter(fn (Expense $expense) => $this->matches($entry->type, (int) $entry->getAttribute($entry->type.'_id'), $expense));
            $contributing = $linked->filter(fn (Expense $expense) => ($owners[$expense->id] ?? null) === $entry->id);
            $parts = $contributing->map(fn (Expense $expense) => ['allocated' => $expense->allocated_amount, 'actual' => $expense->actual_amount])->values()->all();
            $values = $this->values($parts);
            $rows[] = [
                'id' => $entry->id, 'type' => $entry->type, 'source_id' => $source?->id,
                'description' => $names[$entry->id], 'position' => $entry->position,
                'cost_center_id' => $entry->cost_center_id, 'cost_center' => $entry->costCenter,
                'vendor' => $source instanceof Contract || $source instanceof Expense ? $source->vendor : null,
                'notes' => $source?->getAttribute('notes') ?? $source?->getAttribute('description'),
                'starts_on' => $source?->getAttribute('starts_on')?->toDateString(), 'ends_on' => $source?->getAttribute('ends_on')?->toDateString(),
                ...$values,
                'expenses' => $linked->map(function (Expense $expense) use ($owners, $names, $entry) {
                    $data = $expense->toArray();
                    $data['lines'] = $expense->lines->values()->toArray();
                    $data['contributes'] = ($owners[$expense->id] ?? null) === $entry->id;
                    $data['counted_in'] = $names[$owners[$expense->id] ?? 0] ?? null;

                    return $data;
                })->values()->all(),
            ];
        }
        if ($entryIds !== null) {
            $rows = array_values(array_filter($rows, fn ($row) => in_array($row['id'], $entryIds, true)));
        }
        $groups = [];
        foreach (self::TYPES as $type) {
            $groups[$type] = $this->totals(array_values(array_filter($rows, fn ($row) => $row['type'] === $type)));
        }
        $centers = [];
        foreach ($rows as $row) {
            $centers[(string) ($row['cost_center_id'] ?? 'none')][] = $row;
        }
        $includedIds = array_column($rows, 'id');
        $vendors = $expenses->filter(fn (Expense $expense) => in_array($owners[$expense->id] ?? null, $includedIds, true))
            ->groupBy(fn (Expense $expense) => $expense->vendor_id ?? 'none')
            ->map(fn ($group) => [
                'name' => $group->first()->vendor->name ?? 'Senza fornitore',
                ...$this->totals($group->map(fn (Expense $expense) => $this->values([
                    ['allocated' => $expense->allocated_amount, 'actual' => $expense->actual_amount],
                ]))->all()),
            ])->all();

        return [
            'entries' => $rows, 'totals' => $this->totals($rows), 'groups' => $groups,
            'cost_center_groups' => array_map(fn ($group) => $this->totals($group), $centers),
            'vendor_groups' => $vendors,
            'owners' => $owners, 'warnings' => $warnings,
            'has_missing_entries' => $expenses->contains(fn (Expense $expense) => ! isset($owners[$expense->id])),
        ];
    }

    private function matches(string $type, int $id, Expense $expense): bool
    {
        return (int) ($type === 'expense' ? $expense->id : $expense->getAttribute($type.'_id')) === $id;
    }

    /** @param array<int, array{allocated: string|null, actual: string|null}> $parts
     * @return array<string, string|int|null>
     */
    private function values(array $parts): array
    {
        $result = [];
        foreach (['allocated', 'actual'] as $metric) {
            $known = array_filter(array_column($parts, $metric), fn ($amount) => $amount !== null);
            $cents = array_map(fn ($amount) => Money::cents($amount), $known);
            $result[$metric] = $known === [] ? null : Money::decimal(array_sum($cents));
            $result[$metric.'_positive'] = Money::decimal(array_sum(array_filter($cents, fn ($value) => $value > 0)));
            $result[$metric.'_negative'] = Money::decimal(array_sum(array_filter($cents, fn ($value) => $value < 0)));
        }
        $comparable = array_filter($parts, fn ($part) => $part['allocated'] !== null && $part['actual'] !== null);
        $result['variance'] = Money::decimal(Money::cents($result['actual'] ?? '0.00') - Money::cents($result['allocated'] ?? '0.00'));
        $result['estimated_count'] = $result['allocated'] !== null && $result['actual'] === null ? 1 : 0;
        $result['comparable_count'] = count($comparable);

        return $result;
    }

    /** @param array<int, array<string, mixed>> $rows
     * @return array<string, string|int|null>
     */
    public function totals(array $rows): array
    {
        $result = ['count' => count($rows), 'estimated_count' => array_sum(array_column($rows, 'estimated_count')), 'comparable_count' => array_sum(array_column($rows, 'comparable_count'))];
        $values = $this->values(array_map(fn ($row) => ['allocated' => $row['allocated'], 'actual' => $row['actual']], $rows));
        foreach (['allocated', 'actual', 'variance'] as $field) {
            $result[$field] = $values[$field];
        }
        foreach (['allocated_positive', 'allocated_negative', 'actual_positive', 'actual_negative'] as $field) {
            $result[$field] = Money::decimal(array_sum(array_map(fn ($row) => Money::cents($row[$field] ?? '0.00'), $rows)));
        }

        return $result;
    }

    /** @return array<int, array<string, mixed>> */
    public function missing(Tenant $tenant, BudgetYear $year): array
    {
        $snapshot = $this->snapshot($tenant, $year);
        /** @var array<int, array<string, mixed>> $rows */
        $rows = $snapshot['entries'];
        $entries = collect($rows);
        $suggestions = [];
        $expenses = $this->expenses($tenant, $year->year);
        foreach ($expenses as $expense) {
            if (isset($snapshot['owners'][$expense->id])) {
                continue;
            }
            $type = $expense->contract_id !== null ? 'contract' : ($expense->project_id !== null ? 'project' : 'expense');
            $id = $type === 'expense' ? $expense->id : $expense->getAttribute($type.'_id');
            $key = $type.':'.$id;
            $existing = $entries->first(fn ($entry) => $entry['type'] === $type && $entry['source_id'] === $id);
            $state = in_array($key, $year->dismissed_sources ?? [], true) ? 'removed' : 'missing';
            $problem = null;
            if ($expense->contract_id !== null && $expense->project_id !== null) {
                $problem = 'La spesa è collegata sia a un contratto sia a un progetto. Scegli esplicitamente un solo collegamento nella modifica spesa.';
            } elseif ($type !== 'expense' && $expense->{$type}->year !== $year->year) {
                $problem = 'La spesa è del '.$year->year.', il contenitore è '.($expense->{$type}->year ?? 'senza anno').'. Correggi l’anno o scegli un contenitore dell’anno della spesa.';
            } elseif ($type !== 'expense' && $entries->contains(fn ($entry) => $entry['type'] === 'expense' && $entry['source_id'] === $expense->id)) {
                $problem = 'Esiste una precedente scelta sulla spesa singola. Risolvi la voce storica prima di includere il contenitore.';
            }
            if ($problem !== null) {
                $key .= ':expense:'.$expense->id;
                $state = 'blocked';
            }
            $suggestions[$key] ??= [
                'key' => $key, 'type' => $type, 'source_id' => $id, 'entry_id' => $existing['id'] ?? null,
                'description' => $problem !== null || $type === 'expense' ? $expense->title : $expense->{$type}?->getAttribute($type === 'contract' ? 'display_name' : 'name'),
                'state' => $state, 'problem' => $problem, 'parts' => [], 'expense_ids' => [],
                'expense_url' => '/t/'.$tenant->slug.'/expenses/'.$expense->id.'?year='.$year->year,
            ];
            $suggestions[$key]['parts'][] = ['allocated' => $expense->allocated_amount, 'actual' => $expense->actual_amount];
            $suggestions[$key]['expense_ids'][] = $expense->id;
        }

        foreach ($suggestions as $blocked) {
            $key = $blocked['type'].':'.$blocked['source_id'];
            if ($blocked['state'] === 'blocked' && isset($suggestions[$key])) {
                $suggestions[$key]['state'] = 'blocked';
                $suggestions[$key]['problem'] = $blocked['problem'];
                $suggestions[$key]['expense_url'] = $blocked['expense_url'];
            }
        }

        return array_values(array_map(function ($suggestion) {
            $values = $this->values($suggestion['parts']);
            unset($suggestion['parts']);

            return [...$suggestion, ...$values];
        }, $suggestions));
    }
}
