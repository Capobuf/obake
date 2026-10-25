import { expect, it, vi } from 'vite-plus/test';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TwoFactorChallenge from '../../resources/js/pages/auth/two-factor-challenge';

const { errors } = vi.hoisted(() => ({ errors: {} as Record<string, string> }));

vi.mock('react', async (importOriginal) => {
    const react = await importOriginal<typeof import('react')>();
    return { ...react, useState: vi.fn(react.useState) };
});

vi.mock('@inertiajs/react', () => ({
    Head: () => null,
    setLayoutProps: vi.fn(),
    Form: ({ children }: { children: (props: object) => ReactNode }) => (
        <form>
            {children({ errors, processing: false, clearErrors: vi.fn() })}
        </form>
    ),
}));

it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
])('labels the real input (recovery=%s, invalid=%s)', (recovery, invalid) => {
    vi.mocked(useState).mockImplementationOnce(() => [recovery, vi.fn()]);
    const field = recovery ? 'recovery_code' : 'code';
    const errorId = recovery ? 'recovery-code-error' : 'code-error';
    const label = recovery ? 'Codice di recupero' : 'Codice di autenticazione';
    delete errors.code;
    delete errors.recovery_code;
    if (invalid) errors[field] = 'Codice non valido';

    const html = renderToStaticMarkup(<TwoFactorChallenge />);
    const input = html.match(new RegExp(`<input[^>]*id="${field}"[^>]*>`))?.[0];
    expect(input).toBeDefined();
    expect(input).toContain(`name="${field}"`);
    expect(html).toMatch(
        new RegExp(`<label[^>]*for="${field}"[^>]*>${label}</label>`),
    );
    expect(input).toContain(`aria-invalid="${invalid}"`);
    if (invalid) {
        expect(input).toContain(`aria-describedby="${errorId}"`);
        expect(html).toContain(`id="${errorId}"`);
        expect(html).toContain('Codice non valido');
    } else {
        expect(input).not.toContain('aria-describedby');
    }
    expect(html).toContain('type="submit"');
});
