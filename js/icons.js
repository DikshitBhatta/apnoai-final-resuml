/** Returns an inline SVG that draws the sprite symbol "#i-<name>". */
export function icon(name, className = '') {
  return `<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}
