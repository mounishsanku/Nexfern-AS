import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { HelpCenter } from '../src/pages/HelpCenter';
import { describe, test, expect } from 'vitest';

describe('HelpCenter', () => {
  test('renders help center title', () => {
    render(<HelpCenter />);
    expect(screen.getByText('Help Center')).toBeInTheDocument();
  });

  test('filters articles based on search query', () => {
    render(<HelpCenter />);
    
    // By default, all articles should be visible
    expect(screen.getByText('First Login & Setup')).toBeInTheDocument();
    expect(screen.getByText('Reconciliation Guide')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText('Search for articles...');
    fireEvent.change(searchInput, { target: { value: 'Reconciliation' } });

    // Should only show reconciliation
    expect(screen.getByText('Reconciliation Guide')).toBeInTheDocument();
    expect(screen.queryByText('First Login & Setup')).not.toBeInTheDocument();
  });
});
