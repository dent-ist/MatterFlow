import { definePreset } from '@primeuix/themes';
import { AuraLite } from './aura-lite';

/**
 * PrimeNG Aura preset (AuraLite: only the components the app renders) themed from docs/ux/tokens.css (light theme only). UI-01 (#954): every
 * colour that has a design token reads it with var(--mf-...), so changing a token re-themes PrimeNG too; the only literals left are the tint steps
 * of the red and primary scales (50-950) that no component reads directly. Brand primary --mf-primary, focus ring --mf-focus, 4px radius.
 */
export const MfPreset = definePreset(AuraLite, {
  components: {
    // The dialog and drawer rule (S18, #619): a title is 16 px / 600 in every dialog and in the Activity drawer (Aura's 18 px is too loud
    // next to the 14 px body); one close button style; the footer has the secondary action on the left and the primary on the right.
    dialog: {
      title: { fontSize: 'var(--mf-fs-lg)', fontWeight: '600' },
    },
    // Toasts (UXR4-21): Aura's success/info/warn/error text is a mid-tone green/blue/yellow/red on a pale tint (below 4.5:1). Dark text
    // of the same hue on the same kind of tint is 7:1 or better, the detail line is the normal text colour.
    toast: {
      success: {
        background: 'var(--mf-toast-success-bg)',
        borderColor: 'var(--mf-toast-success-border)',
        color: 'var(--mf-toast-success-fg)',
        detailColor: 'var(--mf-toast-detail)',
        closeButton: {
          hoverBackground: 'var(--mf-toast-success-hover)',
          focusRing: { color: 'var(--mf-focus)', shadow: 'none' },
        },
      },
      info: {
        background: 'var(--mf-toast-info-bg)',
        borderColor: 'var(--mf-toast-info-border)',
        color: 'var(--mf-toast-info-fg)',
        detailColor: 'var(--mf-toast-detail)',
        closeButton: {
          hoverBackground: 'var(--mf-toast-info-hover)',
          focusRing: { color: 'var(--mf-focus)', shadow: 'none' },
        },
      },
      warn: {
        background: 'var(--mf-toast-warn-bg)',
        borderColor: 'var(--mf-toast-warn-border)',
        color: 'var(--mf-toast-warn-fg)',
        detailColor: 'var(--mf-toast-detail)',
        closeButton: {
          hoverBackground: 'var(--mf-toast-warn-hover)',
          focusRing: { color: 'var(--mf-focus)', shadow: 'none' },
        },
      },
      error: {
        background: 'var(--mf-toast-error-bg)',
        borderColor: 'var(--mf-toast-error-border)',
        color: 'var(--mf-toast-error-fg)',
        detailColor: 'var(--mf-toast-detail)',
        closeButton: {
          hoverBackground: 'var(--mf-toast-error-hover)',
          focusRing: { color: 'var(--mf-focus)', shadow: 'none' },
        },
      },
    },
    // Button variants (UXR-04): primary = filled brand; secondary = white outline; danger = red outline (the red fill is the
    // `mf-btn--solid` class, used only in confirm dialogs); text = link style. One size: 14 px label, 32 px high (src/styles/_buttons.scss).
    button: {
      root: {
        paddingX: '0.75rem',
        paddingY: '0.375rem',
        fontSize: '0.875rem',
        label: { fontWeight: '600' },
        sm: { fontSize: '0.875rem', paddingX: '0.75rem', paddingY: '0.375rem' },
        secondary: {
          background: 'var(--mf-white)',
          hoverBackground: '{surface.100}',
          activeBackground: '{surface.200}',
          borderColor: 'var(--mf-btn-secondary-border)',
          hoverBorderColor: 'var(--mf-btn-secondary-border)',
          activeBorderColor: 'var(--mf-btn-secondary-border)',
          color: 'var(--mf-text)',
          hoverColor: 'var(--mf-text)',
          activeColor: 'var(--mf-text)',
          focusRing: { color: 'var(--mf-focus)', shadow: 'none' },
        },
        danger: {
          background: 'var(--mf-white)',
          hoverBackground: '{red.50}',
          activeBackground: '{red.100}',
          borderColor: '{red.500}',
          hoverBorderColor: '{red.600}',
          activeBorderColor: '{red.700}',
          color: '{red.500}',
          hoverColor: '{red.700}',
          activeColor: '{red.800}',
          focusRing: { color: 'var(--mf-focus)', shadow: 'none' },
        },
      },
      text: {
        secondary: {
          color: 'var(--mf-primary)',
          hoverBackground: '{primary.100}',
          activeBackground: '{primary.200}',
        },
        danger: {
          color: '{red.500}',
          hoverBackground: '{red.50}',
          activeBackground: '{red.100}',
        },
      },
    },
  },
  primitive: {
    borderRadius: { none: '0', xs: '2px', sm: '4px', md: '4px', lg: '8px', xl: '8px' },
    // Danger buttons and text follow the theme danger token (--mf-danger #B42318, 6.5:1 on white) instead of Aura's #ef4444 (3.8:1).
    red: {
      50: '#FDECEA',
      100: '#FADBD7',
      200: '#F4B6AE',
      300: '#EC8B80',
      400: '#D9534A',
      500: 'var(--mf-danger)',
      600: '#9A1D14',
      700: '#7F1710',
      800: '#64120D',
      900: '#4A0E0A',
      950: '#300906',
    },
  },
  semantic: {
    primary: {
      50: '#EEF3FB',
      100: '#E3ECFA',
      200: '#C5D6F2',
      300: '#9DB9E6',
      400: '#6C92D3',
      500: '#3E6DB9',
      600: 'var(--mf-primary)',
      700: 'var(--mf-primary-hover)',
      800: '#112D5C',
      900: '#0C2144',
      950: '#081630',
    },
    focusRing: {
      width: 'var(--mf-focus-width)',
      style: 'solid',
      color: 'var(--mf-focus)',
      offset: 'var(--mf-focus-offset)',
      shadow: 'none',
    },
    // One control look (UXR-25): 14 px text, 40 px high (the min-height is in styles/_forms.scss) and the same focus ring as the
    // native controls (.mf-control), so a p-select next to a native select cannot be told apart.
    formField: {
      fontSize: '0.875rem',
      paddingX: '0.75rem',
      paddingY: '0.5rem',
      focusRing: {
        width: 'var(--mf-focus-width)',
        style: 'solid',
        color: 'var(--mf-focus)',
        offset: 'var(--mf-focus-offset)',
        shadow: 'none',
      },
    },
    colorScheme: {
      light: {
        primary: {
          color: '{primary.600}',
          contrastColor: 'var(--mf-white)',
          hoverColor: '{primary.700}',
          activeColor: '{primary.800}',
        },
        surface: {
          0: 'var(--mf-surface)',
          50: 'var(--mf-bg)',
          100: 'var(--mf-surface-alt)',
          200: 'var(--mf-border)',
        },
        formField: { borderColor: 'var(--mf-border-strong)' },
      },
    },
  },
});
