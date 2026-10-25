<?php

namespace Tests\Feature;

use App\Http\Controllers\Tenant\BudgetController;
use App\Models\BudgetYear;
use App\Models\Tenant;
use App\Models\User;
use App\Services\AnnualBudget;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Inertia\Testing\AssertableInertia as Assert;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class AnnualBudgetTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private BudgetYear $year;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'Budget', 'slug' => 'budget']);
        $this->actingAs(User::factory()->create(['is_super_admin' => true]));
        $this->year = $this->tenant->budgetYears()->create(['year' => 2026]);
    }

    private function url(string $suffix = 'entries', ?BudgetYear $year = null): string
    {
        return '/t/budget/budget/years/'.($year ?? $this->year)->id.'/'.$suffix;
    }

    /** @param array<string, mixed> $extra
     * @return array<string, mixed>
     */
    private function add(string $type, ?int $id = null, array $extra = []): array
    {
        $data = ['type' => $type, ...($id !== null ? ['source_id' => $id] : []), ...$extra];

        return $this->postJson($this->url(), ['entries' => [$data]])->assertOk()->json('budget');
    }

    /** @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function addExpense(array $data): array
    {
        $this->postJson('/t/budget/expenses', ['year' => 2026, ...$data, 'budget_year_id' => $this->year->id])->assertCreated();

        return $this->state();
    }

    /** @return array<string, mixed> */
    private function state(): array
    {
        return app(AnnualBudget::class)->snapshot($this->tenant, $this->year);
    }

    public static function sourceTypes(): array
    {
        return [['expense'], ['contract'], ['project']];
    }

    #[DataProvider('sourceTypes')]
    public function test_deleting_a_removed_source_cleans_all_years_and_preserves_other_sources(string $type): void
    {
        $attributes = [$type === 'expense' ? 'title' : 'name' => 'Sorgente', 'year' => 2026];
        $source = $this->tenant->{$type.'s'}()->create($attributes);
        $kept = $this->tenant->{$type.'s'}()->create($attributes);
        $other = Tenant::create(['name' => 'Altro', 'slug' => 'altro']);
        $foreign = $other->{$type.'s'}()->create($attributes);
        $foreignYear = $other->budgetYears()->create(['year' => 2026, 'dismissed_sources' => [$type.':'.$foreign->id]]);
        $past = $this->tenant->budgetYears()->create(['year' => 2025, 'dismissed_sources' => [$type.':'.$source->id, $type.':'.$kept->id]]);
        $state = $this->add($type, $source->id);
        $entry = $state['entries'][0]['id'];
        $this->patchJson($this->url(), ['action' => 'exclude', 'ids' => [$entry]])->assertUnprocessable();
        $this->patchJson($this->url(), ['action' => 'reactivate', 'ids' => [$entry]])->assertUnprocessable();
        $this->deleteJson('/t/budget/'.$type.'s/'.$source->id)->assertUnprocessable();
        $this->assertSame([$type.':'.$source->id, $type.':'.$kept->id], $past->fresh()->dismissed_sources);
        $this->patchJson($this->url(), ['action' => 'remove', 'ids' => [$entry]])->assertOk();
        $this->assertSame([$type.':'.$source->id], $this->year->fresh()->dismissed_sources);
        $this->deleteJson('/t/budget/'.$type.'s/'.$source->id)->assertOk();
        $this->assertDatabaseMissing($type.'s', ['id' => $source->id]);
        $this->assertSame([], $this->year->fresh()->dismissed_sources);
        $this->assertSame([$type.':'.$kept->id], $past->fresh()->dismissed_sources);
        $this->assertSame([$type.':'.$foreign->id], $foreignYear->fresh()->dismissed_sources);
    }

    public function test_orphan_cleanup_is_idempotent_and_preserves_valid_references_and_economic_data(): void
    {
        $other = Tenant::create(['name' => 'Altro', 'slug' => 'altro']);
        $valid = $foreign = $orphaned = [];
        foreach (['expense', 'contract', 'project'] as $type) {
            $attributes = [$type === 'expense' ? 'title' : 'name' => 'Conserva', 'year' => 2026];
            $record = $this->tenant->{$type.'s'}()->create($attributes);
            $valid[] = $type.':'.$record->id;
            $foreign[] = $type.':'.$other->{$type.'s'}()->create($attributes)->id;
            $deleted = $this->tenant->{$type.'s'}()->create($attributes);
            $orphaned[] = $type.':'.$deleted->id;
            $deleted->delete();
        }
        $state = $this->addExpense(['title' => 'Economia intatta', 'allocated_amount' => '-12.34', 'actual_amount' => '0.00']);
        $this->year->update(['dismissed_sources' => [...$orphaned, ...$valid, ...$foreign]]);
        $past = $this->tenant->budgetYears()->create(['year' => 2025, 'dismissed_sources' => $orphaned]);
        $empty = $this->tenant->budgetYears()->create(['year' => 2027]);
        $foreignYear = $other->budgetYears()->create(['year' => 2026, 'dismissed_sources' => $foreign]);
        $migration = require database_path('migrations/2026_10_21_000000_remove_orphaned_dismissed_budget_sources.php');
        $migration->up();
        $this->assertSame($valid, $this->year->fresh()->dismissed_sources);
        $this->assertSame([], $past->fresh()->dismissed_sources);
        $this->assertNull($empty->fresh()->dismissed_sources);
        $this->assertSame($foreign, $foreignYear->fresh()->dismissed_sources);
        $this->assertSame($state['totals'], $this->state()['totals']);
        $this->assertSame($state['entries'], $this->state()['entries']);
        $before = DB::table('budget_years')->orderBy('id')->get()->toJson();
        $migration->up();
        $this->assertSame($before, DB::table('budget_years')->orderBy('id')->get()->toJson());
    }

    public function test_moving_a_line_year_moves_budget_totals_without_changing_historical_dates(): void
    {
        $contract = $this->tenant->contracts()->create(['name' => 'Storico', 'starts_on' => '2026-01-01', 'ends_on' => '2026-12-31']);
        $response = $this->postJson('/t/budget/expenses', ['title' => 'Canone', 'year' => 2026, 'contract_id' => $contract->id,
            'lines' => [['description' => 'Riga', 'type' => 'allocated', 'unit_price' => '100', 'year' => 2026,
                'period_starts_on' => '2026-01-01', 'period_ends_on' => '2026-12-31']],
        ])->assertCreated();
        $past = $this->tenant->budgetYears()->create(['year' => 2024]);
        foreach ([$this->year, $past] as $year) {
            $year->entries()->create(['tenant_id' => $this->tenant->id, 'type' => 'contract', 'contract_id' => $contract->id]);
        }
        $this->assertSame('100.00', $this->state()['totals']['allocated']);
        $this->patchJson('/t/budget/expenses/'.$response->json('record.id'), ['lines' => [
            ['description' => 'Riga', 'type' => 'allocated', 'unit_price' => '100', 'year' => 2024,
                'period_starts_on' => '2026-01-01', 'period_ends_on' => '2026-12-31'],
        ]])->assertOk();
        $this->assertNull($this->state()['totals']['allocated']);
        $this->assertSame('100.00', app(AnnualBudget::class)->snapshot($this->tenant, $past)['totals']['allocated']);
        $this->assertDatabaseCount('expenses', 1);
        $this->assertDatabaseCount('expense_lines', 1);
    }

    public function test_creation_uses_the_standard_form_and_validates_budget_context_atomically(): void
    {
        $context = ['budget_year_id' => $this->year->id, 'year' => 2026];
        $this->get('/t/budget/expenses/create?'.http_build_query($context))->assertInertia(fn (Assert $page) => $page
            ->component('tenants/create')->where('year', 2026)->where('budgetContext.id', $this->year->id)->where('budgetContext.year', 2026));
        $this->assertDatabaseCount('expenses', 0);
        $this->postJson('/t/budget/expenses', [...$context, 'title' => 'Dal Budget', 'lines' => [
            ['description' => 'Previsione', 'type' => 'allocated', 'unit_price' => '100'],
        ]])->assertCreated();
        $this->assertDatabaseCount('expenses', 1);
        $this->assertDatabaseCount('budget_entries', 1);
        $this->assertSame('100.00', $this->state()['entries'][0]['allocated']);
        $foreign = Tenant::create(['name' => 'Esterno', 'slug' => 'esterno'])->budgetYears()->create(['year' => 2026]);
        foreach ([['year' => 2027], ['budget_year_id' => $foreign->id], ['title' => '']] as $invalid) {
            $this->postJson('/t/budget/expenses', [...$context, 'title' => 'Non creare', ...$invalid])->assertUnprocessable();
        }
        $this->getJson('/t/budget/expenses/create?year=2027&budget_year_id='.$this->year->id)->assertUnprocessable();
        $this->postJson($this->url(), ['entries' => [['type' => 'manual', 'description' => 'Vietata']]])->assertUnprocessable();
        $this->partialMock(BudgetController::class)->shouldReceive('add')->once()
            ->andThrow(ValidationException::withMessages(['budget' => 'Collegamento fallito.']));
        $this->postJson('/t/budget/expenses', [...$context, 'title' => 'Rollback'])->assertUnprocessable();
        $this->assertDatabaseCount('expenses', 1);
        $this->assertDatabaseCount('budget_entries', 1);
    }

    public function test_single_expense_deletion_preserves_used_sources_and_removes_attachments_atomically(): void
    {
        Storage::fake('local');
        $expense = $this->tenant->expenses()->create(['title' => 'Eliminabile', 'year' => 2026]);
        $expense->lines()->create(['description' => 'Riga', 'type' => 'actual', 'unit_price' => 0, 'total' => 0, 'quantity' => 1, 'position' => 0]);
        $state = $this->add('expense', $expense->id);
        $entryId = $state['entries'][0]['id'];
        $file = $expense->attachments()->make(['original_name' => 'prova.pdf', 'path' => 'private/prova.pdf', 'disk' => 'local', 'mime_type' => 'application/pdf', 'size_bytes' => 1]);
        $file->tenant_id = $this->tenant->id;
        $file->save();
        Storage::disk('local')->put($file->path, 'x');
        $other = $this->tenant->budgetYears()->create(['year' => 2027]);
        $reference = $other->entries()->create(['tenant_id' => $this->tenant->id, 'type' => 'expense', 'expense_id' => $expense->id]);
        $this->patchJson($this->url(), ['action' => 'delete_expense', 'ids' => [$entryId]])->assertUnprocessable();
        $this->assertDatabaseHas('budget_entries', ['id' => $entryId]);
        $this->assertDatabaseHas('expenses', ['id' => $expense->id]);
        $reference->delete();
        foreach (['contract', 'project'] as $type) {
            $source = $this->tenant->{$type.'s'}()->create(['name' => 'Usata']);
            $expense->update([$type.'_id' => $source->id]);
            $this->patchJson($this->url(), ['action' => 'delete_expense', 'ids' => [$entryId]])->assertUnprocessable();
            $this->assertDatabaseHas('budget_entries', ['id' => $entryId]);
            $expense->update([$type.'_id' => null]);
        }
        $second = $this->addExpense(['title' => 'Conserva']);
        $this->patchJson($this->url(), ['action' => 'delete_expense', 'ids' => array_column($second['entries'], 'id')])->assertUnprocessable();
        $other->update(['dismissed_sources' => ['expense:'.$expense->id]]);
        $this->patchJson($this->url(), ['action' => 'delete_expense', 'ids' => [$entryId]])->assertOk();
        $this->assertDatabaseMissing('expenses', ['id' => $expense->id]);
        $this->assertDatabaseMissing('budget_entries', ['id' => $entryId]);
        $this->assertDatabaseMissing('attachments', ['id' => $file->id]);
        $this->assertDatabaseCount('expense_lines', 0);
        $this->assertSame([], $other->fresh()->dismissed_sources);
        $this->assertDatabaseCount('expenses', 1);
    }

    public function test_manual_conversion_preserves_null_zero_negatives_years_centers_and_positions_once(): void
    {
        $center = $this->tenant->costCenters()->create(['name' => 'Centro']);
        $future = $this->tenant->budgetYears()->create(['year' => 2027]);
        $expected = [];
        foreach ([[null, null], ['0.00', null], [null, '0.00'], ['-12.34', '0.00']] as $position => [$allocated, $actual]) {
            $year = $position % 2 === 0 ? $this->year : $future;
            $id = DB::table('budget_entries')->insertGetId([
                'tenant_id' => $this->tenant->id, 'budget_year_id' => $year->id, 'type' => 'manual', 'description' => 'Stessa descrizione',
                'manual_allocated' => $allocated, 'manual_actual' => $actual, 'cost_center_id' => $center->id,
                'included' => $position % 2 === 0, 'position' => $position,
            ]);
            $expected[$id] = [$year, $position, $allocated, $actual];
        }
        $migration = require database_path('migrations/2026_10_15_000001_convert_manual_budget_entries_to_expenses.php');
        $migration->up();
        $migration->up();
        $this->assertDatabaseCount('expenses', 4);
        $this->assertDatabaseMissing('budget_entries', ['type' => 'manual']);
        foreach ($expected as $id => [$year, $position, $allocated, $actual]) {
            $entry = $year->entries()->findOrFail($id);
            $expense = $entry->expense;
            $this->assertSame('expense', $entry->type);
            $this->assertSame($position, $entry->position);
            $this->assertSame($position % 2 === 0, $entry->included);
            $this->assertSame('Stessa descrizione', $expense->title);
            $this->assertSame($year->year, $expense->year);
            $this->assertSame($allocated, $expense->allocated_amount);
            $this->assertSame($actual, $expense->actual_amount);
            $this->assertSame([$center->id], $expense->costCenters()->pluck('cost_centers.id')->all());
            $this->assertSame(count(array_filter([$allocated, $actual], fn ($amount) => $amount !== null)), $expense->lines()->count());
        }
    }

    public function test_variance_uses_aggregate_totals_including_separate_expenses_and_filtered_groups(): void
    {
        $project = $this->tenant->projects()->create(['year' => 2026, 'name' => 'Previsione e acquisto']);
        $center = $this->tenant->costCenters()->create(['name' => 'Centro']);
        $forecast = $this->tenant->expenses()->create(['title' => 'Previsione', 'year' => 2026, 'project_id' => $project->id, 'allocated_amount' => '100', 'actual_amount' => null]);
        $actual = $this->tenant->expenses()->create(['title' => 'Acquisto', 'year' => 2026, 'project_id' => $project->id, 'allocated_amount' => null, 'actual_amount' => '80']);
        $state = $this->add('project', $project->id, ['cost_center_id' => $center->id]);
        $this->assertSame('-20.00', $state['entries'][0]['variance']);
        $this->assertSame(0, $state['entries'][0]['estimated_count']);
        $this->assertSame('-20.00', $state['totals']['variance']);
        $this->assertSame('-20.00', $state['groups']['project']['variance']);
        $this->assertSame('-20.00', $state['cost_center_groups'][$center->id]['variance']);
        $this->get('/t/budget/projects/'.$project->id.'?year=2026')->assertInertia(fn (Assert $page) => $page->where('analytics.current.variance', '-20.00'));
        $id = $state['entries'][0]['id'];
        $this->getJson($this->url('').'?entry_ids='.$id)->assertOk()->assertJsonPath('budget.totals.variance', '-20.00');
        $this->getJson($this->url('').'?entry_ids=')->assertOk()->assertJsonPath('budget.totals.variance', '0.00');
        $this->postJson($this->url('entries'), ['entries' => [['type' => 'expense', 'source_id' => $actual->id]]])->assertUnprocessable();
        $this->assertSame('-20.00', $this->state()['totals']['variance']);
        $this->getJson($this->url('').'?entry_ids='.$id)->assertOk()->assertJsonPath('budget.totals.variance', '-20.00');
        $this->year->entries()->where('project_id', $project->id)->delete();
        $this->patchJson('/t/budget/expenses/'.$actual->id, ['project_id' => null])->assertOk();
        $this->patchJson('/t/budget/expenses/'.$forecast->id, ['project_id' => null])->assertOk();
        $this->add('expense', $actual->id);
        $state = $this->add('expense', $forecast->id);
        $this->assertSame('-20.00', $state['totals']['variance']);
        $this->assertSame('-20.00', $state['groups']['expense']['variance']);
        $this->assertSame('-20.00', $state['vendor_groups']['none']['variance']);
        $this->assertSame('80.00', $state['entries'][0]['variance']);
        $this->assertSame('-100.00', $state['entries'][1]['variance']);
        $this->getJson($this->url('').'?entry_ids='.$state['entries'][1]['id'])->assertOk()->assertJsonPath('budget.totals.variance', '-100.00');
    }

    public function test_vendor_distribution_uses_only_expenses_attributed_to_selected_entries(): void
    {
        $vendorA = $this->tenant->vendors()->create(['name' => 'Contenitore e spesa A']);
        $vendorB = $this->tenant->vendors()->create(['name' => 'Solo spese B']);
        $unused = $this->tenant->vendors()->create(['name' => 'Solo contenitore vuoto']);
        $project = $this->tenant->projects()->create(['year' => 2026, 'name' => 'Due fornitori']);
        $contract = $this->tenant->contracts()->create(['year' => 2026, 'name' => 'Contratto A', 'vendor_id' => $vendorA->id]);
        $empty = $this->tenant->contracts()->create(['year' => 2026, 'name' => 'Vuoto', 'vendor_id' => $unused->id]);
        foreach ([
            ['project_id' => $project->id, 'vendor_id' => $vendorA->id, 'allocated_amount' => '100', 'actual_amount' => '80'],
            ['project_id' => $project->id, 'vendor_id' => $vendorB->id, 'allocated_amount' => '200', 'actual_amount' => '150'],
            ['contract_id' => $contract->id, 'vendor_id' => $vendorB->id, 'allocated_amount' => '300', 'actual_amount' => '250'],
            ['contract_id' => $contract->id, 'allocated_amount' => '50', 'actual_amount' => '60'],
            ['contract_id' => $contract->id, 'vendor_id' => $vendorB->id, 'allocated_amount' => '-20', 'actual_amount' => '0'],
            ['contract_id' => $contract->id, 'vendor_id' => $vendorB->id],
            ['vendor_id' => $vendorB->id, 'allocated_amount' => '9999', 'actual_amount' => '9999'],
        ] as $index => $data) {
            $this->tenant->expenses()->create(['title' => 'Spesa '.$index, 'year' => 2026, ...$data]);
        }
        $this->add('project', $project->id);
        $this->add('contract', $contract->id);
        $state = $this->add('contract', $empty->id);
        $this->assertSame('630.00', $state['totals']['allocated']);
        $this->assertSame('540.00', $state['totals']['actual']);
        $this->assertSame($vendorA->id, $state['entries'][1]['vendor']['id']);
        $this->assertNull($state['entries'][0]['vendor']);
        $this->assertSame('100.00', $state['vendor_groups'][$vendorA->id]['allocated']);
        $this->assertSame('80.00', $state['vendor_groups'][$vendorA->id]['actual']);
        $this->assertSame('Solo spese B', $state['vendor_groups'][$vendorB->id]['name']);
        $this->assertSame('480.00', $state['vendor_groups'][$vendorB->id]['allocated']);
        $this->assertSame('400.00', $state['vendor_groups'][$vendorB->id]['actual']);
        $this->assertSame('500.00', $state['vendor_groups'][$vendorB->id]['allocated_positive']);
        $this->assertSame('-20.00', $state['vendor_groups'][$vendorB->id]['allocated_negative']);
        $this->assertSame(4, $state['vendor_groups'][$vendorB->id]['count']);
        $this->assertSame('Senza fornitore', $state['vendor_groups']['none']['name']);
        $this->assertSame('50.00', $state['vendor_groups']['none']['allocated']);
        $this->assertSame('60.00', $state['vendor_groups']['none']['actual']);
        $this->assertArrayNotHasKey($unused->id, $state['vendor_groups']);

        $this->getJson($this->url('').'?entry_ids='.$state['entries'][0]['id'])->assertOk()
            ->assertJsonPath('budget.totals.allocated', '300.00')
            ->assertJsonPath('budget.vendor_groups.'.$vendorA->id.'.allocated', '100.00')
            ->assertJsonPath('budget.vendor_groups.'.$vendorB->id.'.allocated', '200.00')
            ->assertJsonPath('budget.vendor_groups.'.$vendorB->id.'.actual', '150.00')
            ->assertJsonMissingPath('budget.vendor_groups.none');
        $this->getJson($this->url('').'?entry_ids='.$state['entries'][2]['id'])->assertOk()
            ->assertJsonCount(0, 'budget.vendor_groups');
    }

    public function test_vendor_distribution_uses_the_economic_year_of_expense_lines(): void
    {
        $vendor = $this->tenant->vendors()->create(['name' => 'Due anni']);
        $expense = $this->tenant->expenses()->create(['title' => 'Pluriennale', 'year' => 2026, 'vendor_id' => $vendor->id]);
        foreach ([2026 => '100', 2027 => '200'] as $year => $amount) {
            $expense->lines()->create(['year' => $year, 'position' => $year - 2026, 'type' => 'allocated', 'description' => 'Quota', 'unit_price' => $amount, 'quantity' => '1', 'total' => $amount]);
        }
        $next = $this->tenant->budgetYears()->create(['year' => 2027]);
        $next->entries()->create(['tenant_id' => $this->tenant->id, 'type' => 'expense', 'expense_id' => $expense->id]);
        $state = $this->add('expense', $expense->id);
        $this->assertSame('100.00', $state['vendor_groups'][$vendor->id]['allocated']);
        $this->assertNull($state['vendor_groups'][$vendor->id]['actual']);
        $this->assertSame(1, $state['vendor_groups'][$vendor->id]['estimated_count']);
        $this->assertSame('200.00', app(AnnualBudget::class)->snapshot($this->tenant, $next)['vendor_groups'][$vendor->id]['allocated']);
    }

    public function test_report_snapshot_preserves_empty_removed_zero_and_foreign_selections(): void
    {
        $vendor = $this->tenant->vendors()->create(['name' => 'Report vendor']);
        $center = $this->tenant->costCenters()->create(['name' => 'Report']);
        $zero = $this->tenant->expenses()->create(['title' => 'Zero', 'vendor_id' => $vendor->id, 'year' => 2026, 'allocated_amount' => '0', 'actual_amount' => null]);
        $missing = $this->tenant->expenses()->create(['title' => 'Mancante', 'year' => 2026]);
        $excluded = $this->tenant->expenses()->create(['title' => 'Esclusa', 'year' => 2026, 'allocated_amount' => '999', 'actual_amount' => '999']);
        foreach ([$zero, $missing, $excluded] as $expense) {
            $this->add('expense', $expense->id, ['cost_center_id' => $center->id]);
        }
        $ids = $this->year->entries()->orderBy('id')->pluck('id')->all();
        $this->patchJson($this->url(), ['action' => 'remove', 'ids' => [$ids[2]]])->assertOk();
        $snapshot = $this->getJson($this->url('').'?entry_ids='.implode(',', array_slice($ids, 0, 2)))->assertOk()
            ->assertJsonCount(2, 'budget.entries')->assertJsonPath('budget.totals.count', 2)
            ->assertJsonPath('budget.totals.allocated', '0.00')->assertJsonPath('budget.totals.actual', null)
            ->assertJsonPath('budget.totals.variance', '0.00')
            ->json('budget');
        $this->assertSame('0.00', $snapshot['groups']['expense']['allocated']);
        $this->assertSame('0.00', $snapshot['cost_center_groups'][$center->id]['allocated']);
        $this->assertNull($snapshot['entries'][1]['allocated']);
        $this->assertSame('0.00', $snapshot['vendor_groups'][$vendor->id]['allocated']);
        $this->assertSame(1, $snapshot['vendor_groups'][$vendor->id]['count']);
        $this->assertNull($snapshot['vendor_groups']['none']['allocated']);
        $this->getJson($this->url('').'?entry_ids='.$ids[2])->assertUnprocessable();
        $other = Tenant::create(['name' => 'Altro', 'slug' => 'altro']);
        $otherYear = $other->budgetYears()->create(['year' => 2026]);
        $otherExpense = $other->expenses()->create(['title' => 'Privata', 'year' => 2026]);
        $foreign = $otherYear->entries()->create(['tenant_id' => $other->id, 'type' => 'expense', 'expense_id' => $otherExpense->id]);
        $this->getJson($this->url('').'?entry_ids=')->assertOk()
            ->assertJsonCount(0, 'budget.entries')->assertJsonPath('budget.totals.count', 0)
            ->assertJsonPath('budget.totals.allocated', null)->assertJsonCount(0, 'budget.vendor_groups');
        $this->getJson($this->url('').'?entry_ids='.$foreign->id)->assertUnprocessable()->assertJsonValidationErrors('entry_ids');
        $this->getJson($this->url('', $otherYear).'?entry_ids='.$foreign->id)->assertNotFound();
    }

    public function test_variance_preserves_missing_sides_explicit_zero_and_negative_adjustments(): void
    {
        foreach ([[null, '80', '80.00', 0], ['100', null, '-100.00', 1], [null, null, '0.00', 0], ['100', '80', '-20.00', 0], ['80', '100', '20.00', 0], ['100', '0', '-100.00', 0], [null, '0', '0.00', 0], ['0', null, '0.00', 1], ['100', '100', '0.00', 0], ['-20', '-15', '5.00', 0]] as [$allocated, $actual, $variance, $estimates]) {
            $this->year->entries()->delete();
            $expense = $this->tenant->expenses()->create(['title' => 'Confronto', 'year' => 2026, 'allocated_amount' => $allocated, 'actual_amount' => $actual]);
            $state = $this->add('expense', $expense->id);
            $this->assertSame($variance, $state['entries'][0]['variance']);
            $this->assertSame($variance, $state['totals']['variance']);
            $this->assertSame($estimates, $state['entries'][0]['estimated_count']);
            $this->assertSame($estimates, $state['totals']['estimated_count']);
            $this->assertSame($estimates, $state['groups']['expense']['estimated_count']);
        }
    }

    public function test_empty_years_are_explicit_and_unique(): void
    {
        $this->tenant->expenses()->create(['title' => 'Archivio', 'year' => 2027, 'allocated_amount' => '100']);
        $this->getJson($this->url(''))->assertOk()->assertJsonPath('budget.has_missing_entries', false);
        $this->get('/t/budget/budget?year=2027')->assertInertia(fn (Assert $page) => $page->component('tenants/budget')->where('budgetYear', null)->where('budget', null));
        $this->postJson('/t/budget/budget/years', ['year' => 2027])->assertCreated();
        $this->postJson('/t/budget/budget/years', ['year' => 2027])->assertUnprocessable();
        $this->assertDatabaseCount('budget_entries', 0);
        $this->get('/t/budget/budget?year=2027')->assertInertia(fn (Assert $page) => $page->where('budget.totals.allocated', null)->where('budget.has_missing_entries', true)->has('budget.entries', 0));
    }

    public function test_kpis_compare_only_the_previous_budget_of_the_same_tenant(): void
    {
        $this->get('/t/budget/budget?year=2026')->assertInertia(fn (Assert $page) => $page->where('previousBudget', null));

        $previous = $this->tenant->budgetYears()->create(['year' => 2025]);
        $prior = $this->tenant->expenses()->create(['title' => 'Inclusa', 'year' => 2025, 'allocated_amount' => '100.01', 'actual_amount' => '90.02']);
        $previous->entries()->create(['tenant_id' => $this->tenant->id, 'type' => 'expense', 'expense_id' => $prior->id]);
        $excluded = $this->tenant->expenses()->create(['title' => 'Esclusa', 'year' => 2025, 'allocated_amount' => '999.00']);
        $previous->update(['dismissed_sources' => ['expense:'.$excluded->id]]);
        $this->tenant->expenses()->create(['title' => 'Fuori Budget', 'year' => 2025, 'allocated_amount' => '5000']);
        $other = Tenant::create(['name' => 'Altro Budget', 'slug' => 'altro-budget']);
        $foreign = $other->expenses()->create(['title' => 'Altro tenant', 'year' => 2025, 'allocated_amount' => '7000']);
        $other->budgetYears()->create(['year' => 2025])->entries()->create(['tenant_id' => $other->id, 'type' => 'expense', 'expense_id' => $foreign->id]);

        $this->get('/t/budget/budget?year=2026')->assertInertia(fn (Assert $page) => $page
            ->where('previousBudget.year', 2025)
            ->where('previousBudget.totals.allocated', '100.01')
            ->where('previousBudget.totals.actual', '90.02')
            ->where('previousBudget.totals.variance', '-9.99')
            ->where('previousBudget.totals.count', 1)
            ->where('previousBudget.totals.estimated_count', 0));
        $future = $this->tenant->budgetYears()->create(['year' => 2028]);
        $this->get('/t/budget/budget?year='.$future->year)->assertInertia(fn (Assert $page) => $page->where('previousBudget', null));
    }

    public function test_sources_are_references_and_removal_keeps_originals(): void
    {
        $contract = $this->tenant->contracts()->create(['year' => 2026, 'name' => 'Contratto', 'reference_amount' => '90000']);
        $project = $this->tenant->projects()->create(['year' => 2026, 'name' => 'Progetto']);
        $expense = $this->tenant->expenses()->create(['title' => 'Spesa', 'year' => 2026, 'allocated_amount' => '20']);
        $this->add('contract', $contract->id);
        $this->add('project', $project->id);
        $this->add('expense', $expense->id);
        $budget = $this->addExpense(['title' => 'Libera', 'allocated_amount' => '10']);
        $this->assertSame('30.00', $budget['totals']['allocated']);
        $this->assertNull($budget['entries'][0]['allocated']);
        $this->patchJson($this->url(), ['action' => 'remove', 'ids' => array_column($budget['entries'], 'id')])->assertOk();
        $this->assertDatabaseCount('budget_entries', 0);
        $this->assertDatabaseCount('contracts', 1);
        $this->assertDatabaseCount('projects', 1);
        $this->assertDatabaseCount('expenses', 2);
    }

    public function test_contract_conditions_follow_attribution_year_and_refresh_from_source(): void
    {
        $contract = $this->tenant->contracts()->create(['year' => 2026, 'name' => 'Pluriennale', 'reference_amount' => '9999']);
        $response = $this->postJson('/t/budget/expenses', ['title' => 'Servizio', 'year' => 2026, 'contract_id' => $contract->id, 'lines' => [
            ['description' => 'Primo anno', 'type' => 'allocated', 'unit_price' => '120.25', 'year' => 2026, 'period_starts_on' => '2026-03-01', 'period_ends_on' => '2027-02-28'],
            ['description' => 'Fattura', 'type' => 'actual', 'unit_price' => '100.01', 'year' => 2026],
            ['description' => 'Secondo anno', 'type' => 'allocated', 'unit_price' => '300', 'year' => 2027],
        ]])->assertCreated();
        $state = $this->add('contract', $contract->id);
        $this->assertSame('120.25', $state['totals']['allocated']);
        $this->assertSame('-20.24', $state['totals']['variance']);
        $this->assertCount(2, $state['entries'][0]['expenses'][0]['lines']);
        $future = $this->tenant->budgetYears()->create(['year' => 2027]);
        $this->postJson($this->url('entries', $future), ['entries' => [['type' => 'contract', 'source_id' => $contract->id]]])->assertUnprocessable();
        $this->postJson($this->url('entries', $future), ['entries' => [['type' => 'expense', 'source_id' => $response->json('record.id')]]])->assertUnprocessable();
        $this->getJson($this->url('missing', $future))->assertOk()->assertJsonPath('suggestions.0.state', 'blocked')->assertJsonPath('suggestions.0.allocated', '300.00');
        $this->patchJson('/t/budget/expenses/'.$response->json('record.id'), ['lines' => [
            ['description' => 'Aggiornata', 'type' => 'allocated', 'unit_price' => '400.33', 'year' => 2026],
        ]])->assertOk();
        $this->assertSame('400.33', $this->state()['totals']['allocated']);
        $this->assertNull($this->state()['entries'][0]['actual']);
    }

    public function test_null_zero_negatives_aggregate_variance_and_sankey_reconcile(): void
    {
        $contract = $this->tenant->contracts()->create(['year' => 2026, 'name' => 'Parziale']);
        foreach ([['100', null], [null, '50'], ['0', '10'], ['-20.12', '-15.11']] as $index => [$allocated, $actual]) {
            $this->tenant->expenses()->create(['title' => 'Spesa '.$index, 'year' => 2026, 'contract_id' => $contract->id, 'allocated_amount' => $allocated, 'actual_amount' => $actual]);
        }
        $state = $this->add('contract', $contract->id);
        $this->addExpense(['title' => 'Vuota']);
        $this->addExpense(['title' => 'Zero', 'allocated_amount' => '0', 'actual_amount' => '0']);
        $state = $this->state();
        $this->assertSame('79.88', $state['totals']['allocated']);
        $this->assertSame('44.89', $state['totals']['actual']);
        $this->assertSame('-34.99', $state['totals']['variance']);
        $this->assertSame('100.00', $state['totals']['allocated_positive']);
        $this->assertSame('-20.12', $state['totals']['allocated_negative']);
        $this->assertSame(0, $state['totals']['estimated_count']);
        $this->assertNull($state['entries'][1]['allocated']);
        $this->assertSame('0.00', $state['entries'][2]['allocated']);
        $this->assertSame('79.88', $state['groups']['contract']['allocated']);
    }

    public function test_restored_legacy_conflicts_remain_readable_with_explicit_warnings(): void
    {
        $contract = $this->tenant->contracts()->create(['year' => 2026, 'name' => 'Contratto']);
        $project = $this->tenant->projects()->create(['year' => 2026, 'name' => 'Progetto']);
        $expense = $this->tenant->expenses()->create(['title' => 'Condivisa', 'year' => 2026, 'contract_id' => $contract->id, 'project_id' => $project->id, 'allocated_amount' => '100', 'actual_amount' => '80']);
        $this->year->entries()->create(['tenant_id' => $this->tenant->id, 'type' => 'expense', 'expense_id' => $expense->id]);
        foreach (['project' => $project, 'contract' => $contract] as $type => $source) {
            $this->year->entries()->create(['tenant_id' => $this->tenant->id, 'type' => $type, $type.'_id' => $source->id]);
        }
        $state = $this->state();
        $this->assertSame('100.00', $state['totals']['allocated']);
        $this->assertNull($state['entries'][1]['allocated']);
        $this->assertNotEmpty($state['warnings']);
        $this->assertFalse($state['entries'][1]['expenses'][0]['contributes']);
        $this->assertSame('Contratto', $state['entries'][1]['expenses'][0]['counted_in']);
        $this->assertSame(1, $state['vendor_groups']['none']['count']);
        $this->assertSame('100.00', $state['vendor_groups']['none']['allocated']);
        $this->assertSame('80.00', $state['vendor_groups']['none']['actual']);
        $this->getJson($this->url('').'?entry_ids='.$state['entries'][1]['id'])->assertOk()
            ->assertJsonCount(0, 'budget.vendor_groups');
        $this->patchJson($this->url(), ['action' => 'remove', 'ids' => [$state['entries'][2]['id']]])->assertOk()->assertJsonPath('reassigned.0', $expense->id)->assertJsonPath('budget.groups.project.allocated', '100.00');
        $this->patchJson($this->url(), ['action' => 'remove', 'ids' => [$state['entries'][1]['id']]])->assertOk()->assertJsonPath('budget.groups.expense.allocated', '100.00');
        $this->patchJson($this->url(), ['action' => 'reactivate', 'ids' => [$state['entries'][2]['id']]])->assertUnprocessable();
        $this->assertDatabaseCount('expenses', 1);
    }

    public function test_missing_suggestions_and_idempotent_assisted_insertion(): void
    {
        $contract = $this->tenant->contracts()->create(['year' => 2026, 'name' => 'Contratto']);
        $project = $this->tenant->projects()->create(['year' => 2026, 'name' => 'Progetto']);
        foreach ([['contract_id' => $contract->id], ['contract_id' => $contract->id], ['project_id' => $project->id], []] as $index => $links) {
            $this->tenant->expenses()->create(['title' => 'Spesa '.$index, 'year' => 2026, 'allocated_amount' => '10', ...$links]);
        }
        $suggestions = $this->getJson($this->url('missing'))->assertOk()->json('suggestions');
        $this->assertCount(3, $suggestions);
        $this->assertSame('20.00', $suggestions[0]['allocated']);
        $payload = ['entries' => array_map(fn ($row) => ['type' => $row['type'], 'source_id' => $row['source_id']], $suggestions)];
        $this->getJson($this->url(''))->assertOk()->assertJsonPath('budget.has_missing_entries', true);
        $this->postJson($this->url('entries/assist'), ['entries' => [$payload['entries'][0]]])->assertOk()->assertJsonPath('budget.has_missing_entries', true);
        $this->postJson($this->url('entries/assist'), $payload)->assertOk()->assertJsonPath('budget.totals.allocated', '40.00')->assertJsonPath('budget.has_missing_entries', false);
        $this->postJson($this->url('entries/assist'), $payload)->assertOk()->assertJsonPath('budget.has_missing_entries', false);
        $this->assertDatabaseCount('budget_entries', 3);
        $this->getJson($this->url('missing'))->assertOk()->assertJsonCount(0, 'suggestions');
        $id = $this->year->entries()->where('type', 'contract')->firstOrFail()->id;
        $this->patchJson($this->url(), ['action' => 'remove', 'ids' => [$id]])->assertOk()->assertJsonPath('budget.has_missing_entries', true);
        $this->getJson($this->url('missing'))->assertJsonPath('suggestions.0.state', 'removed');
        $this->postJson($this->url('entries/assist'), $payload)->assertUnprocessable();
        $this->assertSame(2, $this->year->entries()->count());
        $payload['entries'][0]['restore'] = true;
        $this->postJson($this->url('entries/assist'), $payload)->assertOk()->assertJsonPath('budget.totals.allocated', '40.00');
    }

    public function test_old_structure_copy_is_unavailable_and_new_year_stays_empty(): void
    {
        $contract = $this->tenant->contracts()->create(['name' => 'Contratto', 'year' => 2026]);
        $this->add('contract', $contract->id);
        $future = $this->tenant->budgetYears()->create(['year' => 2027]);
        $this->postJson($this->url('copy', $future))->assertNotFound();
        $this->assertSame(0, $future->entries()->count());
    }

    public function test_tenant_isolation_authorization_and_batch_rollback(): void
    {
        $other = Tenant::create(['name' => 'Altro', 'slug' => 'altro']);
        $foreignYear = $other->budgetYears()->create(['year' => 2026]);
        $foreign = $other->expenses()->create(['title' => 'Segreta', 'year' => 2026]);
        $this->getJson($this->url('', $foreignYear))->assertNotFound();
        $this->postJson($this->url(), ['entries' => [['type' => 'expense', 'source_id' => $foreign->id]]])->assertUnprocessable();
        $this->postJson($this->url(), ['entries' => [['type' => 'manual', 'description' => 'Non salvare'], ['type' => 'expense', 'source_id' => $foreign->id]]])->assertUnprocessable();
        $this->assertDatabaseCount('budget_entries', 0);
        $expense = $this->tenant->expenses()->create(['title' => 'Propria', 'year' => 2026]);
        $this->addExpense(['title' => 'Originale']);
        $state = $this->add('expense', $expense->id);
        $this->patchJson($this->url(), ['action' => 'update', 'ids' => array_column($state['entries'], 'id'), 'changes' => ['description' => 'Non salvare']])->assertUnprocessable();
        $this->assertSame('Originale', $this->year->entries()->firstOrFail()->expense->title);
        $center = $other->costCenters()->create(['name' => 'Segreto']);
        $this->patchJson($this->url(), ['action' => 'update', 'ids' => [$state['entries'][0]['id']], 'changes' => ['cost_center_id' => $center->id]])->assertUnprocessable();
        $this->patchJson($this->url(), ['action' => 'exclude', 'ids' => [$state['entries'][0]['id'], 99999]])->assertUnprocessable();
        $this->assertTrue($this->year->entries()->firstOrFail()->included);
        $this->actingAs(User::factory()->create())->get('/t/budget/budget')->assertForbidden();
    }

    public function test_referenced_sources_and_centers_cannot_be_deleted_while_present(): void
    {
        $contract = $this->tenant->contracts()->create(['year' => 2026, 'name' => 'Contratto']);
        $project = $this->tenant->projects()->create(['year' => 2026, 'name' => 'Progetto']);
        $expense = $this->tenant->expenses()->create(['title' => 'Spesa', 'year' => 2026]);
        $center = $this->tenant->costCenters()->create(['name' => 'Centro']);
        $this->add('contract', $contract->id);
        $this->add('project', $project->id);
        $state = $this->add('expense', $expense->id, ['cost_center_id' => $center->id]);
        $this->patchJson($this->url(), ['action' => 'exclude', 'ids' => array_column($state['entries'], 'id')])->assertUnprocessable();
        $this->deleteJson('/t/budget/contracts/'.$contract->id)->assertUnprocessable()->assertJsonValidationErrors('budget');
        $this->deleteJson('/t/budget/projects/'.$project->id)->assertUnprocessable();
        $this->deleteJson('/t/budget/expenses/'.$expense->id)->assertUnprocessable();
        $this->deleteJson('/t/budget/cost-centers/'.$center->id, ['delete_children' => false])->assertUnprocessable();
        $unlinked = $this->tenant->expenses()->create(['title' => 'Libera', 'year' => 2026]);
        $this->deleteJson('/t/budget/expenses/batch', ['ids' => [$unlinked->id, $expense->id]])->assertUnprocessable();
        $this->assertDatabaseHas('expenses', ['id' => $unlinked->id]);
        $this->patchJson($this->url(), ['action' => 'remove', 'ids' => array_column($state['entries'], 'id')])->assertOk();
        $this->deleteJson('/t/budget/expenses/'.$expense->id)->assertOk();
    }

    public function test_unnamed_contracts_can_be_selected_and_added_once_without_changing_source_data(): void
    {
        $contract = $this->tenant->contracts()->create(['name' => null, 'year' => 2026]);
        $expense = $this->tenant->expenses()->create(['title' => 'Canone', 'year' => 2026, 'contract_id' => $contract->id, 'allocated_amount' => '120.25', 'actual_amount' => '100.01']);
        $before = $expense->fresh()->getAttributes();
        $url = '/t/budget/budget/options?type=contract&year=2026';
        foreach (['', '&search=', '&search=%20%20'] as $search) {
            $this->getJson($url.$search)->assertOk()->assertExactJson([
                'records' => [['id' => $contract->id, 'name' => 'Contratto senza nome']],
                'page' => 1, 'last_page' => 1, 'total' => 1,
            ]);
        }
        $this->getJson($url.'&id='.$contract->id)->assertOk()
            ->assertJsonPath('record.name', null)->assertJsonPath('record.display_name', 'Contratto senza nome');

        $first = $this->add('contract', $contract->id);
        $this->assertSame($first, $this->add('contract', $contract->id));
        $this->getJson($this->url(''))->assertOk()->assertJsonCount(1, 'budget.entries')
            ->assertJsonPath('budget.entries.0.source_id', $contract->id)
            ->assertJsonPath('budget.entries.0.description', 'Contratto senza nome')
            ->assertJsonPath('budget.totals.allocated', '120.25')->assertJsonPath('budget.totals.actual', '100.01');
        $this->assertSame(1, $this->year->entries()->where('contract_id', $contract->id)->count());
        $this->assertNull($contract->fresh()->name);
        $this->assertSame($before, $expense->fresh()->getAttributes());
    }

    #[DataProvider('sourceTypes')]
    public function test_source_options_preserve_search_pagination_and_source_boundaries(string $type): void
    {
        $field = $type === 'expense' ? 'title' : 'name';
        $relation = $this->tenant->{$type.'s'}();
        $ids = [];
        for ($i = 0; $i < 51; $i++) {
            $ids[] = $relation->create([$field => 'Sorgente', 'year' => 2026])->id;
        }
        $zero = $relation->create([$field => '0', 'year' => 2026]);
        $past = $relation->create([$field => 'Sorgente', 'year' => 2025]);
        $other = Tenant::create(['name' => 'Altro', 'slug' => 'altro']);
        $foreign = $other->{$type.'s'}()->create([$field => 'Sorgente', 'year' => 2026]);
        $invalid = [$past->id, $foreign->id];
        if ($type === 'expense') {
            foreach (['contract', 'project'] as $container) {
                $source = $this->tenant->{$container.'s'}()->create(['name' => 'Contenitore', 'year' => 2026]);
                $invalid[] = $relation->create(['title' => 'Sorgente', 'year' => 2026, $container.'_id' => $source->id])->id;
            }
        }
        $url = '/t/budget/budget/options?year=2026&type='.$type;
        $first = $this->getJson($url)->assertOk()->assertJsonPath('total', 52)
            ->assertJsonPath('last_page', 2)->assertJsonCount(50, 'records')->json('records');
        $second = $this->getJson($url.'&page=2')->assertOk()->assertJsonPath('page', 2)
            ->assertJsonCount(2, 'records')->json('records');
        $this->assertSame([$zero->id, ...$ids], array_column([...$first, ...$second], 'id'));
        $this->getJson($url.'&search=Sorgente&page=2')->assertOk()->assertJsonPath('total', 51)
            ->assertJsonPath('records.0', ['id' => $ids[50], 'name' => 'Sorgente'])->assertJsonCount(1, 'records');
        $this->getJson($url.'&search=0')->assertOk()->assertJsonCount(1, 'records')
            ->assertJsonPath('records.0', ['id' => $zero->id, 'name' => '0']);
        $this->getJson($url.'&search=Assente')->assertOk()->assertJsonCount(0, 'records');
        $this->getJson($url.'&id='.$ids[0])->assertOk()->assertJsonPath('record.id', $ids[0]);
        foreach ($invalid as $id) {
            $this->getJson($url.'&id='.$id)->assertNotFound();
            $this->postJson($this->url(), ['entries' => [['type' => $type, 'source_id' => $id]]])->assertUnprocessable();
        }
        $this->assertSame(0, $this->year->entries()->count());
    }

    public function test_search_is_not_limited_to_initial_options_and_reordering_is_persistent(): void
    {
        for ($i = 0; $i < 110; $i++) {
            $this->tenant->expenses()->create(['title' => sprintf('Spesa %03d', $i), 'year' => 2026]);
        }
        $this->getJson('/t/budget/budget/options?type=expense&search=109')->assertOk()->assertJsonCount(1, 'records');
        $this->getJson('/t/budget/budget/options?type=expense&page=3')->assertOk()->assertJsonPath('total', 110)->assertJsonCount(10, 'records');
        $this->addExpense(['title' => 'Prima']);
        $state = $this->addExpense(['title' => 'Seconda']);
        $ids = array_reverse(array_column($state['entries'], 'id'));
        $this->patchJson($this->url(), ['action' => 'reorder', 'ids' => $ids])->assertOk()->assertJsonPath('budget.entries.0.description', 'Seconda');
        $this->patchJson($this->url(), ['action' => 'reorder', 'ids' => [$ids[0]]])->assertUnprocessable();
    }

    public function test_reordering_preserves_amounts_attribution_and_present_entries(): void
    {
        $contract = $this->tenant->contracts()->create(['year' => 2026, 'name' => 'Contratto']);
        $project = $this->tenant->projects()->create(['year' => 2026, 'name' => 'Progetto']);
        $expense = $this->tenant->expenses()->create(['title' => 'Condivisa', 'year' => 2026, 'contract_id' => $contract->id, 'project_id' => $project->id, 'allocated_amount' => '100', 'actual_amount' => '80']);
        $this->year->entries()->create(['tenant_id' => $this->tenant->id, 'type' => 'contract', 'contract_id' => $contract->id]);
        $this->addExpense(['title' => 'Esclusa', 'allocated_amount' => '999']);
        $this->year->entries()->create(['tenant_id' => $this->tenant->id, 'type' => 'project', 'project_id' => $project->id]);
        $this->year->entries()->create(['tenant_id' => $this->tenant->id, 'type' => 'expense', 'expense_id' => $expense->id]);
        $before = $this->addExpense(['title' => 'Rettifica', 'allocated_amount' => '-20.12', 'actual_amount' => '0']);
        $before = $this->state();
        $ids = array_reverse(array_column($before['entries'], 'id'));
        $after = $this->patchJson($this->url(), ['action' => 'reorder', 'ids' => $ids])->assertOk()->json('budget');

        $this->assertSame($ids, array_column($after['entries'], 'id'));
        $this->assertSame($ids, array_column($this->state()['entries'], 'id'));
        $this->assertSame($before['totals'], $after['totals']);
        $this->assertSame($before['groups'], $after['groups']);
        $this->assertSame($before['owners'], $after['owners']);
        $this->assertEquals($before['cost_center_groups'], $after['cost_center_groups']);
        $byId = array_column($after['entries'], null, 'id');
        foreach ($before['entries'] as $entry) {
            $reordered = $byId[$entry['id']];
            unset($entry['position'], $reordered['position']);
            $this->assertSame($entry, $reordered);
        }
        $this->assertDatabaseHas('expenses', ['id' => $expense->id, 'allocated_amount' => '100.00', 'actual_amount' => '80.00']);
        $this->patchJson($this->url(), ['action' => 'reorder', 'ids' => [$ids[0], $ids[0], ...array_slice($ids, 2)]])->assertUnprocessable();
        $this->assertSame($ids, array_column($this->state()['entries'], 'id'));
    }

    public function test_assisted_insertion_preserves_intentionally_removed_expenses(): void
    {
        $contract = $this->tenant->contracts()->create(['year' => 2026, 'name' => 'Contratto']);
        $first = $this->tenant->expenses()->create(['title' => 'Esclusa', 'year' => 2026, 'allocated_amount' => '100']);
        $second = $this->tenant->expenses()->create(['title' => 'Mancante', 'year' => 2026, 'contract_id' => $contract->id, 'allocated_amount' => '20']);
        $state = $this->add('expense', $first->id);
        $this->patchJson($this->url(), ['action' => 'remove', 'ids' => [$state['entries'][0]['id']]])->assertOk();
        $suggestions = $this->getJson($this->url('missing'))->assertOk()->json('suggestions');
        $this->assertSame(['expense', 'contract'], array_column($suggestions, 'type'));
        $this->postJson($this->url('entries/assist'), ['entries' => [['type' => 'contract', 'source_id' => $contract->id]]])->assertOk()->assertJsonPath('budget.totals.allocated', '20.00');
        $this->assertFalse($this->year->entries()->where('expense_id', $first->id)->exists());
        $this->assertContains('expense:'.$first->id, $this->year->fresh()->dismissed_sources);
    }

    public function test_cost_center_totals_and_comparable_counts_do_not_duplicate_covered_expenses(): void
    {
        $center = $this->tenant->costCenters()->create(['name' => 'Centro']);
        $contract = $this->tenant->contracts()->create(['year' => 2026, 'name' => 'Contratto']);
        $expense = $this->tenant->expenses()->create(['title' => 'Spesa', 'year' => 2026, 'contract_id' => $contract->id, 'allocated_amount' => '0', 'actual_amount' => '10']);
        $this->postJson($this->url('entries'), ['entries' => [['type' => 'expense', 'source_id' => $expense->id]]])->assertUnprocessable();
        $this->add('contract', $contract->id, ['cost_center_id' => $center->id]);
        $state = $this->addExpense(['title' => 'Libera', 'allocated_amount' => '20', 'actual_amount' => '30']);
        $this->assertSame(2, $state['totals']['comparable_count']);
        $this->assertSame('10.00', $state['cost_center_groups'][(string) $center->id]['actual']);
        $this->assertSame('30.00', $state['cost_center_groups']['none']['actual']);
        $this->assertSame('20.00', $state['totals']['variance']);
    }

    public function test_undated_lines_retain_the_original_expense_year_in_expanded_details(): void
    {
        $contract = $this->tenant->contracts()->create(['year' => 2026, 'name' => 'Contratto']);
        $expense = $this->tenant->expenses()->create(['title' => 'Mista', 'year' => 2026, 'contract_id' => $contract->id]);
        foreach ([[null, '40'], [2027, '100']] as [$year, $total]) {
            $expense->lines()->create(['description' => 'Condizione', 'type' => 'allocated', 'unit_price' => $total, 'total' => $total, 'quantity' => '1', 'position' => 0, 'year' => $year]);
        }
        $state = $this->add('contract', $contract->id);
        $this->assertSame('40.00', $state['entries'][0]['allocated']);
        $this->assertCount(1, $state['entries'][0]['expenses'][0]['lines']);
        $future = $this->tenant->budgetYears()->create(['year' => 2027]);
        $this->postJson($this->url('entries', $future), ['entries' => [['type' => 'expense', 'source_id' => $expense->id]]])->assertUnprocessable();
        $this->getJson($this->url('missing', $future))->assertOk()->assertJsonPath('suggestions.0.state', 'blocked')->assertJsonPath('suggestions.0.allocated', '100.00');
    }

    public function test_database_rejects_cross_tenant_source_references(): void
    {
        $other = Tenant::create(['name' => 'Altro', 'slug' => 'altro']);
        $expense = $other->expenses()->create(['title' => 'Segreta', 'year' => 2026]);
        $this->expectException(QueryException::class);
        DB::table('budget_entries')->insert(['tenant_id' => $this->tenant->id, 'budget_year_id' => $this->year->id, 'type' => 'expense', 'expense_id' => $expense->id]);
    }

    public function test_database_rejects_improper_source_shape_and_cross_tenant_references(): void
    {
        $this->expectException(QueryException::class);
        DB::table('budget_entries')->insert(['tenant_id' => $this->tenant->id, 'budget_year_id' => $this->year->id, 'type' => 'expense', 'description' => 'Impropria']);
    }

    #[DataProvider('sourceTypes')]
    public function test_legacy_exclusion_is_converted_once_without_changing_sources(string $type): void
    {
        $source = $this->tenant->{$type.'s'}()->create([$type === 'expense' ? 'title' : 'name' => 'Storica', 'year' => 2026]);
        $before = $source->fresh()->getAttributes();
        $entry = $this->year->entries()->forceCreate(['tenant_id' => $this->tenant->id, 'type' => $type, $type.'_id' => $source->id, 'included' => false]);
        $this->addExpense(['title' => 'Presente', 'allocated_amount' => '10.00', 'actual_amount' => '0.00']);
        $migration = require database_path('migrations/2026_10_24_120000_remove_excluded_budget_entries.php');
        $migration->up();
        $migration->up();
        $this->assertDatabaseMissing('budget_entries', ['id' => $entry->id]);
        $this->assertSame([$type.':'.$source->id], $this->year->fresh()->dismissed_sources);
        $this->assertSame($before, $source->fresh()->getAttributes());
        $this->assertSame('10.00', $this->state()['totals']['allocated']);
        $this->assertSame('0.00', $this->state()['totals']['actual']);
        $this->postJson($this->url(), ['entries' => [['type' => $type, 'source_id' => $source->id, 'reactivate' => true]]])->assertUnprocessable();
        $this->add($type, $source->id, ['restore' => true]);
        $this->assertSame([], $this->year->fresh()->dismissed_sources);
    }

    public function test_legacy_conversion_rejects_incoherent_sources_without_partial_removal(): void
    {
        $source = $this->tenant->expenses()->create(['title' => 'Storica', 'year' => 2026]);
        $entry = $this->year->entries()->forceCreate(['tenant_id' => $this->tenant->id, 'type' => 'expense', 'expense_id' => $source->id, 'included' => false]);
        try {
            $rows = [(array) DB::table('budget_entries')->where('id', $entry->id)->first()];
            $rows[0]['type'] = 'project';
            $years = [(array) DB::table('budget_years')->where('id', $this->year->id)->first()];
            AnnualBudget::normalizeLegacyEntries($rows, $years);
            $this->fail('Conversione incoerente accettata');
        } catch (ValidationException $error) {
            $this->assertStringContainsString('Riferimento Budget storico incoerente', $error->getMessage());
        }
        $this->assertDatabaseHas('budget_entries', ['id' => $entry->id, 'included' => false]);
        $this->assertNull($this->year->fresh()->dismissed_sources);
    }
}
