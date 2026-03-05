// Shared writable store that controls the ManageRepertoireModal visibility.
// Any page or component can import this and set it to `true` to open the modal,
// which is rendered at the layout root level (outside the header stacking context).

import { writable } from 'svelte/store';

export const manageRepertoiresOpen = writable(false);
