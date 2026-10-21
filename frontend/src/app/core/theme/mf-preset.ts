import { definePreset } from '@primeuix/themes';
import { AuraLite } from './aura-lite';

/**
 * PrimeNG Aura preset (AuraLite: only the components the app renders) themed from docs/ux/tokens.css (light theme only in Phase 1).
 * Brand primary #1F4E9C, focus ring #B45309 (2px solid, 2px offset), 4px radius, Segoe UI stack.
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
        background: '#E6F4EA',
        borderColor: '#9ED2AD',
        color: '#14532D',
        detailColor: '#1B1F27',
        closeButton: {
          hoverBackground: '#CDE9D5',
          focusRing: { color: '#B45309', shadow: 'none' },
        },
      },
      info: {
        background: '#E3ECFA',
        borderColor: '#9DB9E6',
        color: '#173C79',
        detailColor: '#1B1F27',
        closeButton: {
          hoverBackground: '#C5D6F2',
          focusRing: { color: '#B45309', shadow: 'none' },
        },
      },
      warn: {
        background: '#FEF3C7',
        borderColor: '#EBC663',
        color: '#78350F',
        detailColor: '#1B1F27',
        closeButton: {
          hoverBackground: '#FCE79A',
          focusRing: { color: '#B45309', shadow: 'none' },
        },
      },
      error: {
        background: '#FDECEA',
        borderColor: '#F4B6AE',
        color: '#7F1710',
        detailColor: '#1B1F27',
        closeButton: {
          hoverBackground: '#FADBD7',
          focusRing: { color: '#B45309', shadow: 'none' },
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
          background: '#FFFFFF',
          hoverBackground: '{surface.100}',
          activeBackground: '{surface.200}',
          borderColor: '#6B7280',
          hoverBorderColor: '#6B7280',
          activeBorderColor: '#6B7280',
          color: '#1B1F27',
          hoverColor: '#1B1F27',
          activeColor: '#1B1F27',
          focusRing: { color: '#B45309', shadow: 'none' },
        },
        danger: {
          background: '#FFFFFF',
          hoverBackground: '{red.50}',
          activeBackground: '{red.100}',
          borderColor: '{red.500}',
          hoverBorderColor: '{red.600}',
          activeBorderColor: '{red.700}',
          color: '{red.500}',
          hoverColor: '{red.700}',
          activeColor: '{red.800}',
          focusRing: { color: '#B45309', shadow: 'none' },
        },
      },
      text: {
        secondary: {
          color: '#1F4E9C',
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
      500: '#B42318',
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
      600: '#1F4E9C',
      700: '#173C79',
      800: '#112D5C',
      900: '#0C2144',
      950: '#081630',
    },
    focusRing: { width: '2px', style: 'solid', color: '#B45309', offset: '2px', shadow: 'none' },
    // One control look (UXR-25): 14 px text, 40 px high (the min-height is in styles/_forms.scss) and the same focus ring as the
    // native controls (.mf-control), so a p-select next to a native select cannot be told apart.
    formField: {
      fontSize: '0.875rem',
      paddingX: '0.75rem',
      paddingY: '0.5rem',
      focusRing: { width: '2px', style: 'solid', color: '#B45309', offset: '2px', shadow: 'none' },
    },
    colorScheme: {
      light: {
        primary: {
          color: '{primary.600}',
          contrastColor: '#FFFFFF',
          hoverColor: '{primary.700}',
          activeColor: '{primary.800}',
        },
        surface: { 0: '#FFFFFF', 50: '#F5F6F8', 100: '#EEF0F4', 200: '#C9CED8' },
        formField: { borderColor: '#6B7280' },
      },
    },
  },
});
