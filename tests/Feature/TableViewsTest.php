<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class TableViewsTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'Tabelle', 'slug' => 'tabelle']);
        $this->actingAs(User::factory()->create(['is_super_admin' => true]));
    }

    public function test_linked_expenses_filter_and_sort_before_pagination_without_changing_chart_totals(): void
    {
        $contract = $this->tenant->contracts()->create(['name' => 'Contratto']);
        $other = $this->tenant->contracts()->create(['name' => 'Altro contratto']);
        $vendor = $this->tenant->vendors()->create(['name' => 'Fornitore']);
        foreach (range(1, 30) as $index) {
            $this->tenant->expenses()->create(['title' => 'Canone '.$index, 'contract_id' => $contract->id, 'vendor_id' => $vendor->id, 'year' => 2026, 'allocated_amount' => $index, 'actual_amount' => $index]);
        }
        $this->tenant->expenses()->create(['title' => 'Canone esterno', 'contract_id' => $other->id, 'vendor_id' => $vendor->id, 'year' => 2026, 'actual_amount' => 999]);
        $this->tenant->expenses()->create(['title' => 'Archivio storico', 'contract_id' => $contract->id, 'year' => 2025, 'actual_amount' => 77]);
        $path = '/t/tabelle/contracts/'.$contract->id;
        $this->get($path.'?year=2026&sort=actual_amount&direction=desc&vendor_id='.$vendor->id)
            ->assertInertia(fn (Assert $page) => $page->has('expenses.data', 25)
                ->where('expenses.total', 30)->where('expenses.data.0.title', 'Canone 30')
                ->where('expenses.data.24.title', 'Canone 6')->where('totals.count', 30)
                ->where('breakdown.actual.net', '465.00')->where('expenseFilters.sort', 'actual_amount'));
        $this->get($path.'?year=2026&search=Canone%2030&contract_id='.$other->id)
            ->assertInertia(fn (Assert $page) => $page->has('expenses.data', 1)
                ->where('expenses.data.0.title', 'Canone 30')->where('totals.count', 30)
                ->where('breakdown.actual.net', '465.00'));
        $this->get($path.'?year=2026&history=1&search=Archivio')
            ->assertInertia(fn (Assert $page) => $page->has('expenses.data', 1)
                ->where('expenses.data.0.year', 2025)->where('history', true)
                ->where('expenseFilters.history', '1')->where('totals.count', 30));
        $this->get($path.'?year=2026&sort=invalid&direction=invalid')
            ->assertOk()->assertInertia(fn (Assert $page) => $page->where('expenseFilters.sort', 'period_starts_on')->where('expenseFilters.direction', 'asc'));
    }

    public function test_catalog_count_sort_applies_to_all_pages_and_keeps_filters(): void
    {
        foreach (range(1, 27) as $index) {
            $vendor = $this->tenant->vendors()->create(['name' => 'Fornitore '.$index]);
            foreach (range(1, $index) as $expense) {
                $this->tenant->expenses()->create(['title' => 'Spesa '.$expense, 'vendor_id' => $vendor->id, 'year' => 2026]);
            }
        }
        $this->get('/t/tabelle/vendors?sort=expenses_count&direction=desc&linked=1')
            ->assertInertia(fn (Assert $page) => $page->has('records.data', 25)
                ->where('records.data.0.name', 'Fornitore 27')->where('records.data.24.name', 'Fornitore 3')
                ->where('filters.sort', 'expenses_count')->where('filters.linked', '1'));
        $this->get('/t/tabelle/vendors?sort=expenses_count&direction=desc&linked=1&page=2')
            ->assertInertia(fn (Assert $page) => $page->has('records.data', 2)->where('records.data.0.name', 'Fornitore 2'));
    }

    public function test_cost_center_sort_keeps_children_under_their_parent_and_searches_children(): void
    {
        $a = $this->tenant->costCenters()->create(['name' => 'Alfa']);
        $z = $this->tenant->costCenters()->create(['name' => 'Zeta']);
        $child = $this->tenant->costCenters()->create(['name' => 'Figlio', 'parent_id' => $a->id]);
        $this->get('/t/tabelle/cost-centers?direction=desc')
            ->assertInertia(fn (Assert $page) => $page->where('records.data.0.id', $z->id)
                ->where('records.data.1.id', $a->id)->where('records.data.1.children.0.id', $child->id));
        $this->get('/t/tabelle/cost-centers?search=Figlio&direction=desc')
            ->assertInertia(fn (Assert $page) => $page->has('records.data', 1)
                ->where('records.data.0.id', $a->id)->where('records.data.0.children.0.id', $child->id)
                ->where('filters.direction', 'desc'));
    }

    public function test_live_search_covers_economic_rows_relations_and_only_their_annual_lines(): void
    {
        $vendor = $this->tenant->vendors()->create(['name' => 'Partner Dell']);
        $project = $this->tenant->projects()->create(['name' => 'Migrazione', 'year' => 2026]);
        $contract = $this->tenant->contracts()->create(['name' => 'Infrastruttura', 'year' => 2026]);
        $center = $this->tenant->costCenters()->create(['name' => 'Datacenter']);
        foreach (range(1, 51) as $index) {
            $this->tenant->expenses()->create(['title' => 'A spesa '.$index, 'year' => 2026]);
        }
        $expense = $this->tenant->expenses()->create(['title' => 'Z server', 'notes' => 'Garanzia estesa', 'year' => 2025,
            'vendor_id' => $vendor->id, 'project_id' => $project->id, 'contract_id' => $contract->id]);
        $expense->costCenters()->attach($center);
        foreach ([
            ['year' => 2026, 'description' => 'Server Dell', 'type' => 'allocated', 'unit_price' => '625.25', 'quantity' => 2, 'total' => '1250.50'],
            ['year' => 2026, 'description' => 'Saldo', 'type' => 'actual', 'unit_price' => '1200.25', 'quantity' => 1, 'total' => '1200.25'],
            ['year' => 2025, 'description' => 'Archivio segreto', 'type' => 'actual', 'unit_price' => '9988.77', 'quantity' => 1, 'total' => '9988.77'],
            ['year' => null, 'description' => 'Riga legacy', 'type' => 'actual', 'unit_price' => '8877.66', 'quantity' => 1, 'total' => '8877.66'],
        ] as $line) {
            $expense->lines()->create(['position' => 0, ...$line]);
        }
        $foreign = Tenant::create(['name' => 'Estranea', 'slug' => 'estranea']);
        $foreign->expenses()->create(['title' => 'Server Dell', 'year' => 2026, 'actual_amount' => '1250.50']);
        $this->get('/t/tabelle/expenses?year=2026&page=2')->assertInertia(fn (Assert $page) => $page->has('expenses.data', 2));
        foreach ([' server DELL ', 'Garanzia', 'Partner Dell', 'Migrazione', 'Infrastruttura', 'Datacenter', '625,25', '1250,50', '1.250,50', '1200.25', '-50,25'] as $search) {
            $this->get('/t/tabelle/expenses?'.http_build_query(['year' => 2026, 'search' => $search, 'project_id' => $project->id]))
                ->assertInertia(fn (Assert $page) => $page->has('expenses.data', 1)
                    ->where('expenses.data.0.id', $expense->id)->where('expenses.current_page', 1)
                    ->where('totals.allocated', '1250.50')->where('totals.actual', '1200.25'));
        }
        foreach (['Archivio segreto', '9988,77', 'Riga legacy', '8877,66', '1250,51', '%', '_'] as $search) {
            $this->get('/t/tabelle/expenses?'.http_build_query(['year' => 2026, 'search' => $search]))
                ->assertInertia(fn (Assert $page) => $page->has('expenses.data', 0));
        }
        $path = '/t/tabelle/contracts/'.$contract->id;
        $this->get($path.'?year=2026&search=Dell')->assertInertia(fn (Assert $page) => $page->has('expenses.data', 1)->where('totals.allocated', '1250.50'));
        $this->get($path.'?year=2026&search=Archivio')->assertInertia(fn (Assert $page) => $page->has('expenses.data', 0)->where('totals.allocated', '1250.50'));
        $this->get($path.'?year=2026&history=1&search=Archivio')->assertInertia(fn (Assert $page) => $page->has('expenses.data', 1)->where('expenses.data.0.year', 2025)->where('totals.allocated', '1250.50'));
    }

    public function test_catalog_search_returns_parents_for_annual_expenses_and_relevant_fields(): void
    {
        $vendor = $this->tenant->vendors()->create(['name' => 'Acme', 'notes' => 'Assistenza', 'vat_number' => 'IT123456']);
        $expenseVendor = $this->tenant->vendors()->create(['name' => 'Partner Dell']);
        $this->tenant->projectStatuses()->create(['name' => 'In lavorazione', 'key' => 'active']);
        foreach (['projects', 'contracts'] as $catalog) {
            foreach (range(1, 26) as $index) {
                $this->tenant->{$catalog}()->create(['name' => 'A voce '.$index, 'year' => 2026]);
            }
            $parent = $this->tenant->{$catalog}()->create(['name' => 'Z infrastruttura', 'year' => 2026,
                ...($catalog === 'contracts' ? ['notes' => 'Rinnovo', 'vendor_id' => $vendor->id, 'reference_amount' => '4321.09'] : ['description' => 'Rinnovo', 'status' => 'active'])]);
            $field = $catalog === 'contracts' ? 'contract_id' : 'project_id';
            foreach (range(1, 2) as $index) {
                $expense = $this->tenant->expenses()->create(['title' => 'Server Dell', 'year' => 2025, $field => $parent->id, 'vendor_id' => $expenseVendor->id]);
                $expense->lines()->create(['position' => 0, 'description' => 'Licenza speciale', 'type' => 'actual', 'year' => 2026, 'unit_price' => '1250.50', 'quantity' => 1, 'total' => '1250.50']);
                $expense->lines()->create(['position' => 0, 'description' => 'Solo archivio', 'type' => 'actual', 'year' => 2025, 'unit_price' => '9988.77', 'quantity' => 1, 'total' => '9988.77']);
            }
            $this->get('/t/tabelle/'.$catalog.'?year=2026&page=2')->assertInertia(fn (Assert $page) => $page->has('records.data', 2));
            foreach (['Dell', 'Partner Dell', 'Licenza speciale', '1.250,50', 'Rinnovo', ...($catalog === 'contracts' ? ['Acme', '4321,09'] : ['In lavorazione'])] as $search) {
                $this->get('/t/tabelle/'.$catalog.'?'.http_build_query(['year' => 2026, 'search' => $search]))
                    ->assertInertia(fn (Assert $page) => $page->has('records.data', 1)->where('records.data.0.id', $parent->id)->where('records.current_page', 1));
            }
            foreach (['Solo archivio', '9988,77'] as $search) {
                $this->get('/t/tabelle/'.$catalog.'?'.http_build_query(['year' => 2026, 'search' => $search]))
                    ->assertInertia(fn (Assert $page) => $page->has('records.data', 0));
            }
            $this->get('/t/tabelle/'.$catalog.'?year=2027&search=Dell')->assertInertia(fn (Assert $page) => $page->has('records.data', 0));
        }
        foreach (['Assistenza', 'IT123456'] as $search) {
            $this->get('/t/tabelle/vendors?search='.$search)->assertInertia(fn (Assert $page) => $page->has('records.data', 1)->where('records.data.0.id', $vendor->id));
        }
    }

    public function test_amount_search_preserves_zero_negative_null_and_decimal_precision(): void
    {
        $zero = $this->tenant->expenses()->create(['title' => 'Zero', 'year' => 2026, 'actual_amount' => '0.00']);
        $negative = $this->tenant->expenses()->create(['title' => 'Rettifica', 'year' => 2026, 'actual_amount' => '-1250.50']);
        $this->tenant->expenses()->create(['title' => 'Assente', 'year' => 2026]);
        $this->tenant->expenses()->create(['title' => 'Diverso', 'year' => 2026, 'actual_amount' => '1250.51']);
        foreach (['0' => $zero->id, '-1.250,50' => $negative->id] as $search => $id) {
            $this->get('/t/tabelle/expenses?'.http_build_query(['year' => 2026, 'search' => $search]))
                ->assertInertia(fn (Assert $page) => $page->has('expenses.data', 1)->where('expenses.data.0.id', $id));
        }
        foreach (['1250,50', 'null', '1e3', '1250abc'] as $search) {
            $this->get('/t/tabelle/expenses?'.http_build_query(['year' => 2026, 'search' => $search]))
                ->assertInertia(fn (Assert $page) => $page->has('expenses.data', 0));
        }
    }
}
