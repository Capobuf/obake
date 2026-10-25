<?php

namespace Tests\Feature;

use App\Models\BudgetEntry;
use App\Models\Expense;
use App\Models\Tenant;
use App\Models\User;
use App\Services\AnnualBudget;
use App\Services\ExpenseWriter;
use App\Services\UndoHistory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class BudgetReassignmentTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'Alfa', 'slug' => 'alfa']);
        $this->actingAs(User::factory()->create(['is_super_admin' => true]));
    }

    private function fixture(string $type = 'project', bool $present = false): array
    {
        $target = $this->tenant->{$type.'s'}()->create(['name' => 'Destinazione', 'year' => 2026]);
        $expense = app(ExpenseWriter::class)->create($this->tenant, [
            'title' => 'Servizio', 'year' => 2026, 'notes' => 'Conservare',
            'lines' => [
                ['description' => 'Previsione', 'type' => 'allocated', 'unit_price' => '100.01', 'year' => 2026],
                ['description' => 'Rettifica', 'type' => 'allocated', 'unit_price' => '-10.00', 'year' => 2026],
                ['description' => 'Effettivo zero', 'type' => 'actual', 'unit_price' => '0.00', 'year' => 2026],
            ],
        ]);
        $year = $this->tenant->budgetYears()->create(['year' => 2026]);
        $entry = $year->entries()->create(['tenant_id' => $this->tenant->id, 'type' => 'expense', 'expense_id' => $expense->id]);
        if ($present) {
            $year->entries()->create(['tenant_id' => $this->tenant->id, 'type' => $type, $type.'_id' => $target->id]);
        }

        return [$expense, $target, $year, $entry];
    }

    private function url(Expense $expense): string
    {
        return '/t/alfa/expenses/'.$expense->id.'/budget-reassignment';
    }

    public static function states(): array
    {
        return [['project', 'add'], ['project', 'link'], ['contract', 'add'], ['contract', 'link']];
    }

    public static function transfers(): iterable
    {
        foreach (['contract', 'project'] as $sourceType) {
            foreach (['contract', 'project'] as $targetType) {
                foreach ([[true, false, 'add'], [true, false, 'link'], [false, true, 'link'], [true, true, 'link'], [false, false, 'link']] as [$included, $present, $choice]) {
                    yield "$sourceType-$targetType-$included-$present-$choice" => [$sourceType, $targetType, $included, $present, $choice];
                }
            }
        }
    }

    #[DataProvider('transfers')]
    public function test_container_transfers_preview_only_inclusion_changes_and_preserve_source(string $sourceType, string $targetType, bool $included, bool $present, string $choice): void
    {
        [$expense, $target, $year, $direct] = $this->fixture($targetType, $present);
        $direct->delete();
        $source = $this->tenant->{$sourceType.'s'}()->create(['name' => 'Partenza', 'year' => 2026]);
        $expense->update([$sourceType.'_id' => $source->id]);
        if ($included) {
            $year->entries()->create(['tenant_id' => $this->tenant->id, 'type' => $sourceType, $sourceType.'_id' => $source->id]);
        }
        $this->tenant->expenses()->create(['title' => 'Resta alla partenza', 'year' => 2026, $sourceType.'_id' => $source->id, 'allocated_amount' => '10.04', 'actual_amount' => '99.99']);
        $this->tenant->expenses()->create(['title' => 'Già alla destinazione', 'year' => 2026, $targetType.'_id' => $target->id, 'allocated_amount' => '500.00']);
        $before = app(UndoHistory::class)->snapshot($this->tenant);
        $data = ['contract_id' => null, 'project_id' => null, $targetType.'_id' => $target->id];
        if ($included === $present) {
            $this->patchJson('/t/alfa/expenses/'.$expense->id, $data)->assertOk();
        } else {
            $this->patchJson('/t/alfa/expenses/'.$expense->id, $data)->assertUnprocessable()->assertJsonPath('code', 'budget_reassignment_required');
            $preview = $this->patchJson($this->url($expense).'/preview', $data)->assertOk()->assertJsonPath('valid', true)->assertJsonPath('automatic', false)
                ->assertJsonPath('years.0.difference.link.allocated', $included ? '-90.01' : '90.01')
                ->assertJsonPath('years.0.difference.link.actual', '0.00');
            if (! $present) {
                $preview->assertJsonPath('years.0.difference.add.allocated', '500.00');
            }
            $this->assertEquals($before, app(UndoHistory::class)->snapshot($this->tenant));
            $this->patchJson($this->url($expense), [...$data, 'token' => $preview->json('token'), 'confirmed' => true, 'choice' => $choice])->assertOk();
            $this->assertSame($preview->json('years.0.budget_after.'.$choice), app(AnnualBudget::class)->snapshot($this->tenant, $year->fresh())['totals']);
        }
        $after = app(UndoHistory::class)->snapshot($this->tenant);
        foreach (['expense_lines', 'attachments', 'cost_center_expense'] as $table) {
            $this->assertEquals($before[$table], $after[$table]);
        }
        $this->assertSame($target->id, $expense->fresh()->getAttribute($targetType.'_id'));
        $this->assertSame($included ? 1 : 0, $year->entries()->where($sourceType.'_id', $source->id)->count());
        $this->assertEmpty($year->fresh()->dismissed_sources);
        $undo = $this->postJson('/t/alfa/undo')->assertOk()->json('action_id');
        $this->assertEquals($before, app(UndoHistory::class)->snapshot($this->tenant));
        $this->postJson('/t/alfa/undo/restore', ['action_id' => $undo])->assertOk();
        $this->assertEquals($after, app(UndoHistory::class)->snapshot($this->tenant));
    }

    public function test_container_transfer_batch_is_atomic_and_stale_preview_is_rejected(): void
    {
        [$expense, $target, $year, $entry] = $this->fixture('contract');
        $source = $this->tenant->contracts()->create(['name' => 'Partenza', 'year' => 2026]);
        $entry->update(['type' => 'contract', 'expense_id' => null, 'contract_id' => $source->id]);
        $expense->update(['contract_id' => $source->id]);
        $other = $this->tenant->expenses()->create(['title' => 'Invariata', 'year' => 2026]);
        $before = app(UndoHistory::class)->snapshot($this->tenant);
        $data = ['contract_id' => $target->id];
        $this->patchJson('/t/alfa/expenses/batch', ['updates' => [
            ['id' => $other->id, 'title' => 'Non salvata'], ['id' => $expense->id, ...$data],
        ]])->assertUnprocessable()->assertJsonValidationErrors('updates.1.budget');
        $this->assertEquals($before, app(UndoHistory::class)->snapshot($this->tenant));
        $preview = $this->patchJson($this->url($expense).'/preview', $data)->assertOk();
        $this->tenant->expenses()->create(['title' => 'Sopraggiunta', 'year' => 2026, 'contract_id' => $source->id, 'actual_amount' => '1.00']);
        $before = app(UndoHistory::class)->snapshot($this->tenant);
        $this->patchJson($this->url($expense), [...$data, 'token' => $preview->json('token'), 'confirmed' => true, 'choice' => 'add'])->assertConflict();
        $this->assertEquals($before, app(UndoHistory::class)->snapshot($this->tenant));
    }

    public function test_transfer_between_years_previews_each_budget_separately(): void
    {
        $source = $this->tenant->contracts()->create(['name' => '2026', 'year' => 2026]);
        $target = $this->tenant->projects()->create(['name' => '2027', 'year' => 2027]);
        $expense = $this->tenant->expenses()->create(['title' => 'Da spostare', 'year' => 2026, 'contract_id' => $source->id, 'allocated_amount' => '100.05', 'actual_amount' => '99.99']);
        $years = [];
        foreach ([2026 => ['contract', $source], 2027 => ['project', $target]] as $number => [$type, $container]) {
            $years[$number] = $this->tenant->budgetYears()->create(['year' => $number]);
            $years[$number]->entries()->create(['tenant_id' => $this->tenant->id, 'type' => $type, $type.'_id' => $container->id]);
            $this->tenant->expenses()->create(['title' => 'Resta', 'year' => $number, $type.'_id' => $container->id, 'allocated_amount' => '500.00', 'actual_amount' => '200.00']);
        }
        $data = ['contract_id' => null, 'project_id' => $target->id, 'year' => 2027];
        $this->patchJson('/t/alfa/expenses/'.$expense->id, $data)->assertUnprocessable()->assertJsonPath('code', 'budget_reassignment_required');
        $preview = $this->patchJson($this->url($expense).'/preview', $data)->assertOk()->assertJsonPath('valid', true)
            ->assertJsonPath('years.0.year', 2026)->assertJsonPath('years.0.difference.link.allocated', '-100.05')->assertJsonPath('years.0.difference.link.actual', '-99.99')
            ->assertJsonPath('years.1.year', 2027)->assertJsonPath('years.1.difference.link.allocated', '100.05')->assertJsonPath('years.1.difference.link.actual', '99.99');
        $this->patchJson($this->url($expense), [...$data, 'token' => $preview->json('token'), 'confirmed' => true, 'choice' => 'link'])->assertOk();
        foreach ([2026, 2027] as $index => $number) {
            $this->assertSame($preview->json("years.$index.budget_after.link"), app(AnnualBudget::class)->snapshot($this->tenant, $years[$number])['totals']);
        }
        $this->assertDatabaseCount('budget_entries', 2);
    }

    public function test_unrelated_years_and_unchanged_links_do_not_require_confirmation(): void
    {
        [$expense, $target, $year, $entry] = $this->fixture('contract');
        $source = $this->tenant->contracts()->create(['name' => 'Partenza', 'year' => 2026]);
        $entry->update(['type' => 'contract', 'expense_id' => null, 'contract_id' => $source->id]);
        $expense->update(['contract_id' => $source->id]);
        $this->patchJson('/t/alfa/expenses/'.$expense->id, ['contract_id' => (string) $source->id, 'notes' => 'Aggiornate'])->assertOk();
        $expense->lines()->update(['year' => 2027]);
        $expense->update(['year' => 2027]);
        $this->patchJson('/t/alfa/expenses/'.$expense->id, ['contract_id' => $target->id])->assertOk();
        $this->assertSame($target->id, $expense->fresh()->contract_id);
        $this->assertSame($source->id, $entry->fresh()->contract_id);
    }

    #[DataProvider('states')]
    public function test_both_choices_are_read_only_and_match_committed_totals(string $type, string $choice): void
    {
        [$expense, $target, $year, $entry] = $this->fixture($type);
        $this->tenant->expenses()->create(['title' => 'Altre spese', 'year' => 2026, $type.'_id' => $target->id, 'allocated_amount' => '500.00']);
        $center = $this->tenant->costCenters()->create(['name' => 'IT']);
        $expense->costCenters()->sync([$center->id]);
        $expense->attachments()->forceCreate(['tenant_id' => $this->tenant->id, 'original_name' => 'documento.pdf', 'disk' => 'attachments', 'path' => 'documento.pdf', 'mime_type' => 'application/pdf', 'size_bytes' => 1]);
        $data = [$type.'_id' => $target->id];
        $before = app(UndoHistory::class)->snapshot($this->tenant);
        $this->patchJson('/t/alfa/expenses/'.$expense->id, $data)->assertUnprocessable()->assertJsonPath('code', 'budget_reassignment_required');
        $queries = [];
        DB::listen(function ($query) use (&$queries) {
            $queries[] = $query->sql;
        });
        $preview = $this->patchJson($this->url($expense).'/preview', $data)->assertOk()->assertJsonPath('valid', true)
            ->assertJsonPath('automatic', false)->assertJsonPath('choices.add.valid', true)
            ->assertJsonPath('years.0.budget_after.add.allocated', '590.01')->assertJsonPath('years.0.budget_after.link.allocated', null)
            ->assertJsonPath('years.0.difference.add.allocated', '500.00')->assertJsonPath('years.0.difference.link.allocated', '-90.01')
            ->assertJsonPath('years.0.expense_before.allocated', '90.01')->assertJsonPath('years.0.expense_after.actual', '0.00');
        $this->assertSame([], array_values(array_filter($queries, fn ($sql) => preg_match('/^\s*(insert|update|delete|replace)\b/i', $sql))));
        $this->assertEquals($before, app(UndoHistory::class)->snapshot($this->tenant));
        $this->patchJson($this->url($expense), [...$data, 'token' => $preview->json('token'), 'confirmed' => true])->assertUnprocessable();
        $this->patchJson($this->url($expense), [...$data, 'token' => $preview->json('token'), 'confirmed' => false, 'choice' => $choice])->assertUnprocessable();
        $confirmation = [...$data, 'token' => $preview->json('token'), 'confirmed' => true, 'choice' => $choice];
        $this->patchJson($this->url($expense), $confirmation)->assertOk();
        $snapshot = app(AnnualBudget::class)->snapshot($this->tenant, $year->fresh());
        $this->assertSame($snapshot['totals'], $preview->json('years.0.budget_after.'.$choice));
        $this->assertSame($target->id, $expense->fresh()->getAttribute($type.'_id'));
        $this->assertDatabaseMissing('budget_entries', ['id' => $entry->id]);
        $this->assertSame(['expense:'.$expense->id], $year->fresh()->dismissed_sources);
        $after = app(UndoHistory::class)->snapshot($this->tenant);
        foreach (['expense_lines', 'attachments', 'cost_center_expense'] as $table) {
            $this->assertEquals($before[$table], $after[$table]);
        }
        $this->assertSame('Conservare', $expense->fresh()->notes);
        $this->assertDatabaseCount('expenses', 2);
        $this->assertDatabaseCount('budget_entries', $choice === 'add' ? 1 : 0);
        $this->patchJson($this->url($expense), $confirmation)->assertConflict();
        $this->assertEquals($after, app(UndoHistory::class)->snapshot($this->tenant));
    }

    #[DataProvider('states')]
    public function test_existing_container_links_automatically_and_absent_expenses_do_not_add_it(string $type, string $mode): void
    {
        [$expense, $target, $year, $entry] = $this->fixture($type, $mode === 'add');
        $this->tenant->expenses()->create(['title' => 'Altra', 'year' => 2026, $type.'_id' => $target->id, 'allocated_amount' => '200.00']);
        if ($mode === 'link') {
            $entry->delete();
        }
        $before = app(AnnualBudget::class)->snapshot($this->tenant, $year)['totals'];
        $this->patchJson('/t/alfa/expenses/'.$expense->id, [$type.'_id' => $target->id])->assertOk()->assertJsonPath('record.'.$type.'_id', $target->id);
        $after = app(AnnualBudget::class)->snapshot($this->tenant, $year->fresh())['totals'];
        foreach (['allocated', 'actual', 'variance'] as $metric) {
            $this->assertSame($before[$metric], $after[$metric]);
        }
        $this->assertDatabaseCount('budget_entries', $mode === 'add' ? 1 : 0);
        $this->assertSame($mode === 'add' ? ['expense:'.$expense->id] : null, $year->fresh()->dismissed_sources);
    }

    public function test_full_form_draft_is_previewed_and_saved_together_without_preview_writes(): void
    {
        [$expense, $target, $year] = $this->fixture();
        $data = ['project_id' => $target->id, 'title' => 'Titolo modificato', 'notes' => 'Bozza', 'lines' => [
            ['description' => 'Rettifica', 'type' => 'allocated', 'unit_price' => '-0.01', 'year' => 2026],
        ]];
        $before = app(UndoHistory::class)->snapshot($this->tenant);
        $preview = $this->patchJson($this->url($expense).'/preview', $data)->assertOk()->assertJsonPath('valid', true)
            ->assertJsonPath('years.0.expense_after.allocated', '-0.01')->assertJsonPath('years.0.expense_after.actual', null)
            ->assertJsonPath('years.0.difference.add.allocated', '-90.02');
        $this->assertEquals($before, app(UndoHistory::class)->snapshot($this->tenant));
        $this->patchJson($this->url($expense), [...$data, 'token' => $preview->json('token'), 'confirmed' => true, 'choice' => 'add'])->assertOk();
        $this->assertSame('Titolo modificato', $expense->fresh()->title);
        $this->assertSame('Bozza', $expense->fresh()->notes);
        $this->assertSame($preview->json('years.0.budget_after.add'), app(AnnualBudget::class)->snapshot($this->tenant, $year)['totals']);
    }

    public function test_multiyear_preview_uses_annual_amounts_and_requires_manual_correction(): void
    {
        [$expense, $target, $year] = $this->fixture();
        $expense->lines()->create(['description' => 'Anno successivo', 'type' => 'actual', 'unit_price' => '-15.02', 'quantity' => 1, 'total' => '-15.02', 'year' => 2027, 'position' => 3]);
        $expense->update(['actual_amount' => '-15.02']);
        $otherYear = $this->tenant->budgetYears()->create(['year' => 2027]);
        $otherYear->entries()->create(['tenant_id' => $this->tenant->id, 'type' => 'expense', 'expense_id' => $expense->id]);
        $data = ['project_id' => $target->id];
        $before = app(UndoHistory::class)->snapshot($this->tenant);
        $preview = $this->patchJson($this->url($expense).'/preview', $data)->assertOk()->assertJsonPath('valid', false)
            ->assertJsonPath('years.0.expense_before.allocated', '90.01')->assertJsonPath('years.0.expense_before.actual', '0.00')
            ->assertJsonPath('years.1.expense_before.allocated', null)->assertJsonPath('years.1.expense_before.actual', '-15.02')
            ->assertJsonCount(1, 'years.1.direct_entries');
        $this->patchJson($this->url($expense), [...$data, 'token' => $preview->json('token'), 'confirmed' => true, 'choice' => 'add'])->assertUnprocessable();
        $this->assertEquals($before, app(UndoHistory::class)->snapshot($this->tenant));
    }

    public static function changes(): array
    {
        return [['expense'], ['line'], ['target'], ['position'], ['entry'], ['budget'], ['other_expense'], ['payload'], ['target_year'], ['expense_link'], ['direct_removed']];
    }

    #[DataProvider('changes')]
    public function test_stale_state_or_changed_payload_cannot_be_confirmed(string $change): void
    {
        [$expense, $target, $year, $entry] = $this->fixture();
        $data = ['project_id' => $target->id];
        $preview = $this->patchJson($this->url($expense).'/preview', $data)->assertOk();
        match ($change) {
            'expense' => $expense->update(['notes' => 'Cambiata']),
            'line' => $expense->lines()->first()->update(['description' => 'Cambiata']),
            'target' => $target->update(['name' => 'Cambiato']),
            'position' => $entry->update(['position' => 99]),
            'entry' => $year->entries()->create(['tenant_id' => $this->tenant->id, 'type' => 'project', 'project_id' => $target->id]),
            'budget' => $year->update(['dismissed_sources' => ['project:999']]),
            'other_expense' => $this->tenant->expenses()->create(['title' => 'Altra', 'year' => 2026, 'project_id' => $target->id, 'actual_amount' => '10.00']),
            'payload' => $data['title'] = 'Payload alterato',
            'target_year' => $target->update(['year' => 2027]),
            'expense_link' => $expense->update(['project_id' => $target->id]),
            'direct_removed' => $entry->delete(),
        };
        $before = app(UndoHistory::class)->snapshot($this->tenant);
        $this->patchJson($this->url($expense), [...$data, 'token' => $preview->json('token'), 'confirmed' => true, 'choice' => 'add'])->assertConflict();
        $this->assertEquals($before, app(UndoHistory::class)->snapshot($this->tenant));
    }

    public function test_foreign_target_permissions_existing_links_and_batch_remain_validated(): void
    {
        [$expense, $target] = $this->fixture();
        $other = Tenant::create(['name' => 'Other', 'slug' => 'other']);
        $foreign = $other->projects()->create(['name' => 'Esterno', 'year' => 2026]);
        $before = app(UndoHistory::class)->snapshot($this->tenant);
        $this->patchJson($this->url($expense).'/preview', ['project_id' => $foreign->id])->assertUnprocessable();
        $this->patchJson('/t/other/expenses/'.$expense->id.'/budget-reassignment/preview', ['project_id' => $foreign->id])->assertNotFound();
        $this->patchJson('/t/alfa/expenses/batch', ['updates' => [['id' => $expense->id, 'project_id' => $target->id, 'title' => 'Non salvato']]])->assertUnprocessable();
        $this->assertEquals($before, app(UndoHistory::class)->snapshot($this->tenant));
        $contract = $this->tenant->contracts()->create(['name' => 'Esistente', 'year' => 2026]);
        $expense->update(['contract_id' => $contract->id]);
        $this->patchJson($this->url($expense).'/preview', ['project_id' => $target->id, 'contract_id' => null])->assertUnprocessable();
        $this->assertSame($contract->id, $expense->fresh()->contract_id);
        $this->actingAs(User::factory()->create());
        $this->patchJson($this->url($expense).'/preview', ['project_id' => $target->id])->assertForbidden();
        $this->patchJson($this->url($expense), ['project_id' => $target->id, 'confirmed' => true, 'token' => 'invalid'])->assertForbidden();
    }

    public function test_period_and_year_drafts_do_not_write_and_show_years_without_a_budget(): void
    {
        $target = $this->tenant->projects()->create(['name' => 'Anno successivo', 'year' => 2027]);
        $expense = app(ExpenseWriter::class)->create($this->tenant, [
            'title' => 'Date condivise', 'year' => 2026, 'period_starts_on' => '2026-01-01', 'period_ends_on' => '2026-12-31',
            'lines' => [['description' => 'Quota', 'type' => 'allocated', 'unit_price' => '-0.01']],
        ]);
        $year = $this->tenant->budgetYears()->create(['year' => 2026]);
        $year->entries()->create(['tenant_id' => $this->tenant->id, 'type' => 'expense', 'expense_id' => $expense->id]);
        $data = ['project_id' => $target->id, 'year' => 2027, 'period_starts_on' => '2027-01-01', 'period_ends_on' => '2027-12-31'];
        $before = app(UndoHistory::class)->snapshot($this->tenant);
        $preview = $this->patchJson($this->url($expense).'/preview', $data)->assertOk()->assertJsonPath('valid', true)->assertJsonPath('choices.add.valid', false)
            ->assertJsonPath('years.0.expense_before.allocated', '-0.01')->assertJsonPath('years.0.expense_after', null)
            ->assertJsonPath('years.1.budget_id', null)->assertJsonPath('years.1.expense_after.allocated', '-0.01')
            ->assertJsonPath('years.1.expense_after.actual', null)->assertJsonPath('years.0.difference.link.allocated', '0.01');
        $this->assertEquals($before, app(UndoHistory::class)->snapshot($this->tenant));
        $lineId = $expense->lines()->sole()->id;
        $this->patchJson($this->url($expense), [...$data, 'token' => $preview->json('token'), 'confirmed' => true, 'choice' => 'link'])->assertOk();
        $this->assertSame($lineId, $expense->lines()->sole()->id);
        $this->assertSame('2027-01-01', $expense->lines()->sole()->period_starts_on->toDateString());
        $this->assertSame($preview->json('years.0.budget_after.link'), app(AnnualBudget::class)->snapshot($this->tenant, $year)['totals']);
        $this->assertDatabaseCount('budget_years', 1);
    }

    public function test_legacy_amounts_and_unclassified_targets_disable_confirmation(): void
    {
        [$expense, $target] = $this->fixture();
        $expense->update(['allocated_amount' => '99.00']);
        $data = ['project_id' => $target->id];
        $preview = $this->patchJson($this->url($expense).'/preview', $data)->assertOk()->assertJsonPath('valid', false);
        $this->patchJson($this->url($expense), [...$data, 'token' => $preview->json('token'), 'confirmed' => true, 'choice' => 'add'])->assertUnprocessable();
        $expense->update(['allocated_amount' => '90.01']);
        $target->update(['year' => null]);
        $preview = $this->patchJson($this->url($expense).'/preview', $data)->assertOk()->assertJsonPath('valid', false);
        $this->patchJson($this->url($expense), [...$data, 'token' => $preview->json('token'), 'confirmed' => true, 'choice' => 'add'])->assertUnprocessable();
        $this->assertNull($expense->fresh()->project_id);
        $this->assertDatabaseCount('budget_entries', 1);
    }

    public function test_failure_after_removal_rolls_back_every_change(): void
    {
        [$expense, $target] = $this->fixture();
        $data = ['project_id' => $target->id, 'title' => 'Bozza'];
        $preview = $this->patchJson($this->url($expense).'/preview', $data)->assertOk();
        $before = app(UndoHistory::class)->snapshot($this->tenant);
        Expense::saving(function ($model) use ($expense) {
            if ($model->id === $expense->id && $model->project_id !== null) {
                throw ValidationException::withMessages(['title' => 'Errore durante il salvataggio.']);
            }
        });
        try {
            $this->patchJson($this->url($expense), [...$data, 'token' => $preview->json('token'), 'confirmed' => true, 'choice' => 'add'])->assertUnprocessable();
            $this->assertEquals($before, app(UndoHistory::class)->snapshot($this->tenant));
        } finally {
            Expense::flushEventListeners();
        }
    }

    public function test_failure_adding_the_container_rolls_back_the_link_and_removals(): void
    {
        [$expense, $target] = $this->fixture();
        $data = ['project_id' => $target->id];
        $preview = $this->patchJson($this->url($expense).'/preview', $data)->assertOk();
        $before = app(UndoHistory::class)->snapshot($this->tenant);
        BudgetEntry::creating(function ($entry) {
            if ($entry->type === 'project') {
                throw ValidationException::withMessages(['budget' => 'Inserimento fallito.']);
            }
        });
        try {
            $this->patchJson($this->url($expense), [...$data, 'choice' => 'add', 'confirmed' => true, 'token' => $preview->json('token')])->assertUnprocessable();
            $this->assertEquals($before, app(UndoHistory::class)->snapshot($this->tenant));
        } finally {
            BudgetEntry::flushEventListeners();
        }
    }
}
