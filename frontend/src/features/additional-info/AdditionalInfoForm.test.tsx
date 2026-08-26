import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  AdditionalInfoForm,
  SITUATION_TYPES,
  DESCRIPTION_MAX_LENGTH,
  PEOPLE_COUNT_MIN,
  PEOPLE_COUNT_MAX,
} from './AdditionalInfoForm';

// Mock sosRepository
vi.mock('../../db/sos-repository', () => ({
  sosRepository: {
    update: vi.fn().mockResolvedValue(undefined),
  },
}));

import { sosRepository } from '../../db/sos-repository';

const mockUpdate = vi.mocked(sosRepository.update);

describe('AdditionalInfoForm', () => {
  const defaultProps = {
    sosId: 'test-sos-123',
    onSubmit: vi.fn(),
    onSkip: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue(undefined);
  });

  describe('Rendering', () => {
    it('renders the form heading', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      expect(screen.getByText('Additional Information')).toBeInTheDocument();
    });

    it('displays optional messaging to indicate fields are not required', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      expect(
        screen.getByText(/this information is optional but helps responders/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/you can skip this/i)).toBeInTheDocument();
    });

    it('renders people count input with label', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      const input = screen.getByLabelText(/number of people/i);
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('type', 'number');
      expect(input).toHaveAttribute('min', String(PEOPLE_COUNT_MIN));
      expect(input).toHaveAttribute('max', String(PEOPLE_COUNT_MAX));
    });

    it('renders situation type select with all options', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      const select = screen.getByLabelText(/situation type/i);
      expect(select).toBeInTheDocument();

      // Check placeholder option
      expect(screen.getByText('Select a situation type')).toBeInTheDocument();

      // Check all situation type options
      SITUATION_TYPES.forEach((type) => {
        expect(screen.getByRole('option', { name: type })).toBeInTheDocument();
      });
    });

    it('renders description textarea with label', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      const textarea = screen.getByLabelText(/description/i);
      expect(textarea).toBeInTheDocument();
      expect(textarea.tagName.toLowerCase()).toBe('textarea');
      expect(textarea).toHaveAttribute('maxlength', String(DESCRIPTION_MAX_LENGTH));
    });

    it('renders character counter showing 0/200', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      expect(screen.getByText(`0/${DESCRIPTION_MAX_LENGTH} characters`)).toBeInTheDocument();
    });

    it('renders Skip and Save buttons', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    });

    it('all fields default to empty', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      const peopleCount = screen.getByLabelText(/number of people/i) as HTMLInputElement;
      const situationType = screen.getByLabelText(/situation type/i) as HTMLSelectElement;
      const description = screen.getByLabelText(/description/i) as HTMLTextAreaElement;

      expect(peopleCount.value).toBe('');
      expect(situationType.value).toBe('');
      expect(description.value).toBe('');
    });
  });

  describe('Character Counter', () => {
    it('updates character count as user types in description', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      const textarea = screen.getByLabelText(/description/i);

      fireEvent.change(textarea, { target: { value: 'Hello' } });
      expect(screen.getByText(`5/${DESCRIPTION_MAX_LENGTH} characters`)).toBeInTheDocument();
    });

    it('prevents typing beyond max character limit', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      const textarea = screen.getByLabelText(/description/i) as HTMLTextAreaElement;

      // Try to enter text exactly at limit
      const exactLimit = 'a'.repeat(DESCRIPTION_MAX_LENGTH);
      fireEvent.change(textarea, { target: { value: exactLimit } });
      expect(textarea.value.length).toBe(DESCRIPTION_MAX_LENGTH);

      // Try to exceed limit
      const overLimit = 'a'.repeat(DESCRIPTION_MAX_LENGTH + 10);
      fireEvent.change(textarea, { target: { value: overLimit } });
      // Value should remain at the limit (not accept over-limit input)
      expect(textarea.value.length).toBe(DESCRIPTION_MAX_LENGTH);
    });

    it('shows counter at max when description is at limit', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      const textarea = screen.getByLabelText(/description/i);

      const maxText = 'a'.repeat(DESCRIPTION_MAX_LENGTH);
      fireEvent.change(textarea, { target: { value: maxText } });
      expect(
        screen.getByText(`${DESCRIPTION_MAX_LENGTH}/${DESCRIPTION_MAX_LENGTH} characters`)
      ).toBeInTheDocument();
    });
  });

  describe('Form Submission', () => {
    it('calls sosRepository.update with all filled fields on save', async () => {
      render(<AdditionalInfoForm {...defaultProps} />);

      fireEvent.change(screen.getByLabelText(/number of people/i), {
        target: { value: '3' },
      });
      fireEvent.change(screen.getByLabelText(/situation type/i), {
        target: { value: 'Trapped' },
      });
      fireEvent.change(screen.getByLabelText(/description/i), {
        target: { value: 'Need help quickly' },
      });

      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith('test-sos-123', {
          peopleCount: 3,
          situationType: 'Trapped',
          description: 'Need help quickly',
        });
      });
    });

    it('calls onSubmit callback with submitted data', async () => {
      render(<AdditionalInfoForm {...defaultProps} />);

      fireEvent.change(screen.getByLabelText(/number of people/i), {
        target: { value: '5' },
      });
      fireEvent.change(screen.getByLabelText(/situation type/i), {
        target: { value: 'Injured' },
      });
      fireEvent.change(screen.getByLabelText(/description/i), {
        target: { value: 'Multiple injuries' },
      });

      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(defaultProps.onSubmit).toHaveBeenCalledWith({
          peopleCount: 5,
          situationType: 'Injured',
          description: 'Multiple injuries',
        });
      });
    });

    it('submits with null values when all fields are empty', async () => {
      render(<AdditionalInfoForm {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith('test-sos-123', {
          peopleCount: null,
          situationType: null,
          description: null,
        });
      });
    });

    it('calls onSubmit with empty data when no fields are filled', async () => {
      render(<AdditionalInfoForm {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(defaultProps.onSubmit).toHaveBeenCalledWith({});
      });
    });

    it('displays error message when sosRepository.update fails', async () => {
      mockUpdate.mockRejectedValueOnce(new Error('DB error'));

      render(<AdditionalInfoForm {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Failed to save additional information'
        );
      });
    });

    it('disables buttons during submission', async () => {
      mockUpdate.mockReturnValue(new Promise(() => {})); // never resolves

      render(<AdditionalInfoForm {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /save additional information/i }));

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /save additional information/i })
        ).toBeDisabled();
        expect(
          screen.getByRole('button', { name: /skip additional information/i })
        ).toBeDisabled();
      });
    });

    it('trims whitespace from description before submitting', async () => {
      render(<AdditionalInfoForm {...defaultProps} />);

      fireEvent.change(screen.getByLabelText(/description/i), {
        target: { value: '  some text with spaces  ' },
      });

      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith('test-sos-123', {
          peopleCount: null,
          situationType: null,
          description: 'some text with spaces',
        });
      });
    });
  });

  describe('Skip Behavior', () => {
    it('calls onSkip callback when Skip button is clicked', () => {
      render(<AdditionalInfoForm {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /skip/i }));

      expect(defaultProps.onSkip).toHaveBeenCalledTimes(1);
    });

    it('does not call sosRepository.update when Skip is clicked', () => {
      render(<AdditionalInfoForm {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: /skip/i }));

      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Validation', () => {
    it('accepts people count within valid range', async () => {
      render(<AdditionalInfoForm {...defaultProps} />);

      fireEvent.change(screen.getByLabelText(/number of people/i), {
        target: { value: '50' },
      });

      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith('test-sos-123', {
          peopleCount: 50,
          situationType: null,
          description: null,
        });
      });
    });

    it('does not include people count if value exceeds max', async () => {
      render(<AdditionalInfoForm {...defaultProps} />);

      fireEvent.change(screen.getByLabelText(/number of people/i), {
        target: { value: '150' },
      });

      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith('test-sos-123', {
          peopleCount: null,
          situationType: null,
          description: null,
        });
      });
    });

    it('does not include people count if value is below min', async () => {
      render(<AdditionalInfoForm {...defaultProps} />);

      fireEvent.change(screen.getByLabelText(/number of people/i), {
        target: { value: '0' },
      });

      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith('test-sos-123', {
          peopleCount: null,
          situationType: null,
          description: null,
        });
      });
    });
  });

  describe('Accessibility', () => {
    it('form has aria-labelledby pointing to the heading', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      const form = screen.getByRole('form');
      expect(form).toHaveAttribute('aria-labelledby', 'additional-info-heading');
    });

    it('people count input has aria-describedby for hint text', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      const input = screen.getByLabelText(/number of people/i);
      expect(input).toHaveAttribute('aria-describedby', 'people-count-hint');
    });

    it('situation type select has aria-describedby for hint text', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      const select = screen.getByLabelText(/situation type/i);
      expect(select).toHaveAttribute('aria-describedby', 'situation-type-hint');
    });

    it('description textarea has aria-describedby pointing to character counter', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      const textarea = screen.getByLabelText(/description/i);
      expect(textarea).toHaveAttribute('aria-describedby', 'description-counter');
    });

    it('character counter has aria-live for screen reader updates', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      const counter = screen.getByText(`0/${DESCRIPTION_MAX_LENGTH} characters`);
      expect(counter).toHaveAttribute('aria-live', 'polite');
      expect(counter).toHaveAttribute('aria-atomic', 'true');
    });

    it('skip button has descriptive aria-label', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      const skipBtn = screen.getByRole('button', { name: /skip additional information/i });
      expect(skipBtn).toBeInTheDocument();
    });

    it('save button has descriptive aria-label', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      const saveBtn = screen.getByRole('button', { name: /save additional information/i });
      expect(saveBtn).toBeInTheDocument();
    });

    it('buttons have minimum touch target size', () => {
      render(<AdditionalInfoForm {...defaultProps} />);
      const buttons = screen.getAllByRole('button');
      buttons.forEach((button) => {
        expect(button.className).toContain('min-h-[48px]');
        expect(button.className).toContain('min-w-[48px]');
      });
    });
  });
});
