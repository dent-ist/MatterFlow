import base from '@primeuix/themes/aura/base';
import badge from '@primeuix/themes/aura/badge';
import button from '@primeuix/themes/aura/button';
import checkbox from '@primeuix/themes/aura/checkbox';
import chip from '@primeuix/themes/aura/chip';
import dialog from '@primeuix/themes/aura/dialog';
import iconfield from '@primeuix/themes/aura/iconfield';
import inputnumber from '@primeuix/themes/aura/inputnumber';
import inputtext from '@primeuix/themes/aura/inputtext';
import multiselect from '@primeuix/themes/aura/multiselect';
import radiobutton from '@primeuix/themes/aura/radiobutton';
import ripple from '@primeuix/themes/aura/ripple';
import select from '@primeuix/themes/aura/select';
import textarea from '@primeuix/themes/aura/textarea';
import toast from '@primeuix/themes/aura/toast';
import tooltip from '@primeuix/themes/aura/tooltip';
import virtualscroller from '@primeuix/themes/aura/virtualscroller';

/**
 * Aura, but with the token sets of only the PrimeNG components this app renders.
 *
 * `@primeuix/themes/aura` imports the token set of every PrimeNG component (about 100 of them, ~115 kB
 * of the initial chunk) although the app renders a dozen. The keys below are the PrimeNG style `name`s of
 * the components in the build, including the ones those components render themselves (multiselect uses
 * chip, checkbox, ...). A component whose key is missing here renders without its theme CSS; the spec
 * `aura-lite.spec.ts` fails when src imports a PrimeNG component that is not listed.
 */
export const AuraLite = {
  ...base,
  components: {
    badge,
    button,
    checkbox,
    chip,
    dialog,
    iconfield,
    inputnumber,
    inputtext,
    multiselect,
    radiobutton,
    ripple,
    select,
    textarea,
    toast,
    tooltip,
    virtualscroller,
  },
};
