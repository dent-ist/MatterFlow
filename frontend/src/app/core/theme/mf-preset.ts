import { definePreset } from '@primeuix/themes';
import Aura from '@primeuix/themes/aura';

/**
 * PrimeNG Aura preset themed from docs/ux/tokens.css (light theme only in Phase 1).
 * Brand primary #1F4E9C, focus ring #B45309 (2px solid, 2px offset), 4px radius, Segoe UI stack.
 */
export const MfPreset = definePreset(Aura, {
  primitive: {
    borderRadius: { none: '0', xs: '2px', sm: '4px', md: '4px', lg: '8px', xl: '8px' },
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
