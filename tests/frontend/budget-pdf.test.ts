import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import { defaultBudgetReportOptions } from '../../resources/js/components/management/budget-report';
import { downloadBudgetPdf } from '../../resources/js/components/management/budget-pdf';

const { factory, body, footerWorker, documentPdf } = vi.hoisted(() => {
    const worker = () => ({
        set: vi.fn(),
        from: vi.fn(),
        toContainer: vi.fn(),
        toCanvas: vi.fn(),
        toPdf: vi.fn(),
        get: vi.fn(),
        save: vi.fn(),
    });
    return {
        factory: vi.fn(),
        body: worker(),
        footerWorker: worker(),
        documentPdf: {
            getNumberOfPages: vi.fn(),
            setPage: vi.fn(),
            addImage: vi.fn(),
            setFont: vi.fn(),
            setFontSize: vi.fn(),
            setTextColor: vi.fn(),
            text: vi.fn(),
            internal: { pageSize: { getWidth: vi.fn(), getHeight: vi.fn() } },
        },
    };
});
vi.mock('html2pdf.js', () => ({ default: factory }));

const remove = vi.fn();
const removeFooter = vi.fn();
const decode = vi.fn();
const queryFooter = vi.fn();
const queryGroups = vi.fn();
const element = {
    querySelectorAll: (selector: string) =>
        selector === 'img' ? [{ decode }] : queryGroups(),
    querySelector: queryFooter,
    cloneNode: () => ({ dataset: {}, append: vi.fn() }),
} as unknown as HTMLElement;

beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('document', { fonts: { ready: Promise.resolve() } });
    queryFooter.mockReturnValue({ cloneNode: () => ({}) });
    queryGroups.mockReturnValue([]);
    factory.mockReturnValueOnce(body).mockReturnValueOnce(footerWorker);
    for (const worker of [body, footerWorker]) {
        worker.set.mockReturnValue(worker);
        worker.from.mockReturnValue(worker);
    }
    body.get.mockImplementation((key) =>
        Promise.resolve(
            key === 'overlay'
                ? { remove }
                : key === 'pdf'
                  ? documentPdf
                  : { scrollHeight: 2000, scrollWidth: 700 },
        ),
    );
    footerWorker.get.mockImplementation((key) =>
        Promise.resolve(
            key === 'overlay'
                ? { remove: removeFooter }
                : { toDataURL: () => 'footer-image' },
        ),
    );
    documentPdf.getNumberOfPages.mockReturnValue(3);
    documentPdf.internal.pageSize.getWidth.mockReturnValue(297);
    documentPdf.internal.pageSize.getHeight.mockReturnValue(210);
});
afterEach(() => vi.unstubAllGlobals());

it.each([
    ['portrait', 942],
    ['landscape', 613],
] as const)(
    'starts only oversized table groups on a new %s page',
    async (orientation, oversizedHeight) => {
        queryGroups.mockReturnValue([
            { getBoundingClientRect: () => ({ height: oversizedHeight - 1 }) },
            {
                getBoundingClientRect: () => ({
                    height: oversizedHeight - 0.5,
                }),
            },
            { getBoundingClientRect: () => ({ height: 1500 }) },
        ]);
        await downloadBudgetPdf(element, 'Budget.pdf', {
            ...defaultBudgetReportOptions('Test'),
            orientation,
        });
        expect(body.set).toHaveBeenCalledWith(
            expect.objectContaining({
                pagebreak: {
                    mode: ['css'],
                    avoid: ['thead', 'tr', 'svg', 'img'],
                    before: [
                        '.budget-report-entry-group:nth-child(2)',
                        '.budget-report-entry-group:nth-child(3)',
                    ],
                },
            }),
        );
        expect(footerWorker.set).toHaveBeenCalledWith(
            expect.objectContaining({
                pagebreak: expect.not.objectContaining({
                    before: expect.anything(),
                }),
            }),
        );
    },
);

it('waits for the logo and adds the same footer to every page before downloading', async () => {
    let loaded!: () => void;
    decode.mockReturnValue(
        new Promise<void>((resolve) => {
            loaded = resolve;
        }),
    );
    const download = downloadBudgetPdf(element, 'Budget.pdf', {
        ...defaultBudgetReportOptions('Test'),
        orientation: 'landscape',
    });
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
    expect(body.save).not.toHaveBeenCalled();
    loaded();
    await download;
    expect(body.set).toHaveBeenCalledWith(
        expect.objectContaining({
            filename: 'Budget.pdf',
            margin: [12, 12, 36, 12],
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        }),
    );
    expect(documentPdf.setPage.mock.calls).toEqual([[1], [2], [3]]);
    expect(documentPdf.addImage.mock.calls).toEqual(
        Array(3).fill(['footer-image', 'PNG', 12, 178, 273, 20]),
    );
    expect(body.save).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(removeFooter).toHaveBeenCalledOnce();
});

it('rejects oversized reports before rendering instead of downloading a blank PDF', async () => {
    body.get.mockImplementation((key) =>
        Promise.resolve(
            key === 'overlay'
                ? { remove }
                : { scrollHeight: 16001, scrollWidth: 700 },
        ),
    );
    await expect(
        downloadBudgetPdf(
            element,
            'Budget.pdf',
            defaultBudgetReportOptions('Test'),
        ),
    ).rejects.toThrow('Report troppo lungo');
    expect(body.save).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnce();
    expect(removeFooter).toHaveBeenCalledOnce();
});

it('does not download an incomplete report when footer rendering fails', async () => {
    footerWorker.toCanvas.mockRejectedValue(new Error('Rendering failed'));
    await expect(
        downloadBudgetPdf(
            element,
            'Budget.pdf',
            defaultBudgetReportOptions('Test'),
        ),
    ).rejects.toThrow('Rendering failed');
    expect(body.save).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnce();
    expect(removeFooter).toHaveBeenCalledOnce();
});

it('rejects a missing footer rather than silently omitting it', async () => {
    queryFooter.mockReturnValue(null);
    await expect(
        downloadBudgetPdf(
            element,
            'Budget.pdf',
            defaultBudgetReportOptions('Test'),
        ),
    ).rejects.toThrow('Footer del report non disponibile');
    expect(body.save).not.toHaveBeenCalled();
});

it.each([
    [false, true, []],
    [false, false, []],
    [true, true, ['1', '2', '3']],
    [true, false, ['1', '2']],
] as const)(
    'numbers pages with enabled=%s and firstPage=%s',
    async (showPageNumbers, numberFirstPage, numbers) => {
        const pages: number[] = [];
        let currentPage = 0;
        documentPdf.setPage.mockImplementation((page) => {
            currentPage = page;
        });
        documentPdf.text.mockImplementation(() => {
            pages.push(currentPage);
        });
        await downloadBudgetPdf(element, 'Budget.pdf', {
            ...defaultBudgetReportOptions('Test'),
            showPageNumbers,
            numberFirstPage,
        });
        expect(documentPdf.text.mock.calls).toEqual(
            numbers.map((number) => [
                number,
                285,
                188,
                { align: 'right', baseline: 'middle' },
            ]),
        );
        expect(pages).toEqual(
            !showPageNumbers ? [] : numberFirstPage ? [1, 2, 3] : [2, 3],
        );
    },
);

it('leaves a single-page report unnumbered when the first page is excluded', async () => {
    documentPdf.getNumberOfPages.mockReturnValue(1);
    await downloadBudgetPdf(element, 'Budget.pdf', {
        ...defaultBudgetReportOptions('Test'),
        showPageNumbers: true,
        numberFirstPage: false,
    });
    expect(documentPdf.text).not.toHaveBeenCalled();
    expect(body.save).toHaveBeenCalledOnce();
});
