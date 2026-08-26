import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HomeScreen } from './HomeScreen';

// Mock the SOS creator service
vi.mock('../../services/sos-creator.service', () => ({
  createSOS: vi.fn(),
}));

import { createSOS } from '../../services/sos-creator.service';

const mockCreateSOS = vi.mocked(createSOS);

describe('HomeScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSOS.mockResolvedValue({
      success: true,
      record: {
        id: 'test-sos-id',
        emergencyType: 'police',
        latitude: null,
        longitude: null,
        accuracy: null,
        locationMethod: null,
        locationTimestamp: null,
        timestamp: new Date(),
        peopleCount: null,
        situationType: null,
        description: null,
        priority: null,
        status: 'queued',
        retryCount: 0,
        lastTransmissionAttempt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  });

  it('renders four emergency type buttons', () => {
    render(<HomeScreen />);

    expect(screen.getByRole('button', { name: /police \/ rescue/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /medical help/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /food \/ water/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /children \/ elderly/i })).toBeInTheDocument();
  });

  it('each button has an accessible aria-label', () => {
    render(<HomeScreen />);

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);

    buttons.forEach((button) => {
      expect(button).toHaveAttribute('aria-label');
      expect(button.getAttribute('aria-label')).toContain('emergency SOS');
    });
  });

  it('calls createSOS with the correct emergency type when Police/Rescue is tapped', async () => {
    render(<HomeScreen />);

    const policeButton = screen.getByRole('button', { name: /police \/ rescue/i });
    fireEvent.click(policeButton);

    await waitFor(() => {
      expect(mockCreateSOS).toHaveBeenCalledWith({ emergencyType: 'police' });
    });
  });

  it('calls createSOS with medical type when Medical Help is tapped', async () => {
    render(<HomeScreen />);

    const medicalButton = screen.getByRole('button', { name: /medical help/i });
    fireEvent.click(medicalButton);

    await waitFor(() => {
      expect(mockCreateSOS).toHaveBeenCalledWith({ emergencyType: 'medical' });
    });
  });

  it('calls createSOS with food type when Food/Water is tapped', async () => {
    render(<HomeScreen />);

    const foodButton = screen.getByRole('button', { name: /food \/ water/i });
    fireEvent.click(foodButton);

    await waitFor(() => {
      expect(mockCreateSOS).toHaveBeenCalledWith({ emergencyType: 'food' });
    });
  });

  it('calls createSOS with childrenElderly type when Children/Elderly is tapped', async () => {
    render(<HomeScreen />);

    const childrenButton = screen.getByRole('button', { name: /children \/ elderly/i });
    fireEvent.click(childrenButton);

    await waitFor(() => {
      expect(mockCreateSOS).toHaveBeenCalledWith({ emergencyType: 'childrenElderly' });
    });
  });

  it('calls onSOSCreated callback with SOS ID on successful creation', async () => {
    const onSOSCreated = vi.fn();
    render(<HomeScreen onSOSCreated={onSOSCreated} />);

    const policeButton = screen.getByRole('button', { name: /police \/ rescue/i });
    fireEvent.click(policeButton);

    await waitFor(() => {
      expect(onSOSCreated).toHaveBeenCalledWith('test-sos-id');
    });
  });

  it('displays an error message when SOS creation fails', async () => {
    mockCreateSOS.mockResolvedValue({
      success: false,
      record: null,
      error: 'IndexedDB write failed',
    });

    render(<HomeScreen />);

    const policeButton = screen.getByRole('button', { name: /police \/ rescue/i });
    fireEvent.click(policeButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('IndexedDB write failed');
    });
  });

  it('disables buttons while SOS creation is in progress', async () => {
    // Make createSOS never resolve to keep the loading state
    mockCreateSOS.mockReturnValue(new Promise(() => {}));

    render(<HomeScreen />);

    const policeButton = screen.getByRole('button', { name: /police \/ rescue/i });
    fireEvent.click(policeButton);

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      buttons.forEach((button) => {
        expect(button).toBeDisabled();
      });
    });
  });

  it('renders buttons with minimum touch target size', () => {
    render(<HomeScreen />);

    const buttons = screen.getAllByRole('button');
    buttons.forEach((button) => {
      // Verify the min-h and min-w classes are applied
      expect(button.className).toContain('min-h-[48px]');
      expect(button.className).toContain('min-w-[48px]');
    });
  });
});
