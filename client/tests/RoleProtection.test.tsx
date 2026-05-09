import React from 'react';
import { render, screen } from '@testing-library/react';
import { RoleProtectedRoute } from '../src/components/RoleProtectedRoute';
import { describe, test, expect, vi } from 'vitest';
import * as authUtils from '../src/utils/roleAuth';
import { MemoryRouter } from 'react-router-dom';

describe('Role Protection', () => {
  beforeEach(() => {
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => 'fake-token'),
      },
      writable: true,
    });
  });

  test('renders children if role is allowed', () => {
    vi.spyOn(authUtils, 'getStoredRole').mockReturnValue('admin');

    render(
      <MemoryRouter>
        <RoleProtectedRoute allowedRoles={['admin']}>
          <div>Protected Content</div>
        </RoleProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  test('renders Access Denied if role is not allowed', () => {
    vi.spyOn(authUtils, 'getStoredRole').mockReturnValue('viewer');

    render(
      <MemoryRouter>
        <RoleProtectedRoute allowedRoles={['admin']}>
          <div>Protected Content</div>
        </RoleProtectedRoute>
      </MemoryRouter>
    );

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });
});
