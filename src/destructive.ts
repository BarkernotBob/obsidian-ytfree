/**
 * Marks a button as destructive: `setDestructive` on Obsidian 1.13+, which
 * deprecated `setWarning`, and `setWarning` on the older versions we support.
 */

import type { ButtonComponent } from "obsidian";

export function markDestructive(button: ButtonComponent): ButtonComponent {
  const modern = button as ButtonComponent & { setDestructive?: () => unknown };
  if (typeof modern.setDestructive === "function") modern.setDestructive();
  else button.setWarning();
  return button;
}
