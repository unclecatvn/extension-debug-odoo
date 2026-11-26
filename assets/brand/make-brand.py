# Writes every Bọ Đô SVG in this folder from one drawing, so the icon, mascot and poses never drift apart.
# Run: python3 assets/brand/make-brand.py   (then sh assets/icons/make-icons.sh for the PNGs)
from pathlib import Path

HERE = Path(__file__).parent
TEAL, PURPLE, DEEP, INK = '#21B799', '#714B67', '#553250', '#2b1a28'


def bodo(body, eye, pupil=None, pose='idle'):
    """Bọ Đô on a 128 grid: round body, two antennae with teal (breakpoint) tips, short arms and feet."""
    right = {'idle': 'M99 76 H110', 'wave': 'M98 70 Q108 62 111 48', 'inspect': 'M99 76 L111 73'}[pose]
    s = [f'<path d="M53 40 Q47 24 39 21 M75 40 Q81 24 89 21 M29 76 H18 {right} M52 104 V112 M76 104 V112" '
         f'fill="none" stroke="{body}" stroke-width="8" stroke-linecap="round"/>',
         f'<circle cx="39" cy="21" r="7.5" fill="{TEAL}"/><circle cx="89" cy="21" r="7.5" fill="{TEAL}"/>',
         f'<circle cx="64" cy="70" r="36" fill="{body}"/>',
         f'<circle cx="51" cy="65" r="11" fill="{eye}"/><circle cx="77" cy="65" r="11" fill="{eye}"/>']
    if pupil:  # coloured body: white eyes, dark pupils
        s += [f'<circle cx="53" cy="66" r="6.5" fill="{pupil}"/><circle cx="79" cy="66" r="6.5" fill="{pupil}"/>',
              f'<circle cx="55" cy="63.5" r="2.5" fill="{eye}"/><circle cx="81" cy="63.5" r="2.5" fill="{eye}"/>']
    else:  # white body: dark eyes with a highlight
        s.append(f'<circle cx="54.5" cy="61" r="4" fill="{body}"/><circle cx="80.5" cy="61" r="4" fill="{body}"/>')
    s.append(f'<path d="M55 84 Q64 92 73 84" fill="none" stroke="{eye}" stroke-width="5" stroke-linecap="round"/>')
    if pose == 'wave':
        s.append(f'<path d="M117 38 L123 33 M119 49 H126" stroke="{TEAL}" stroke-width="4" stroke-linecap="round"/>')
    if pose == 'inspect':
        s.append(f'<path d="M111 73 L124 60" stroke="{body}" stroke-width="7" stroke-linecap="round"/>'
                 f'<circle cx="135" cy="49" r="15" fill="#fff" fill-opacity=".35" stroke="{body}" stroke-width="7"/>'
                 f'<circle cx="135" cy="49" r="5" fill="{TEAL}"/>')
    return ''.join(s)


def svg(name, inner, w=128, h=128):
    (HERE / name).write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{inner}</svg>\n')


TILE = f'<rect x="4" y="4" width="120" height="120" rx="28" fill="{PURPLE}"/>'
ICON = TILE + f'<g transform="translate(64 65) scale(.88) translate(-64 -65)">{bodo("#fff", DEEP)}</g>'
WORD = '<text x="148" y="83" font-family="\'Be Vietnam Pro\', system-ui, -apple-system, \'Segoe UI\', sans-serif" font-size="54" font-weight="700" letter-spacing="-1" fill="{c}">Odoo Debug</text>'
MASK = ('<defs><mask id="m"><rect width="128" height="128" fill="#fff"/>'
        '<circle cx="51" cy="65" r="11" fill="#000"/><circle cx="77" cy="65" r="11" fill="#000"/>'
        '<path d="M55 84 Q64 92 73 84" fill="none" stroke="#000" stroke-width="5" stroke-linecap="round"/></mask></defs>')

svg('bo-do-icon.svg', ICON)                                  # the app icon: white Bọ Đô on the purple tile
svg('bo-do.svg', bodo(PURPLE, '#fff', INK))                  # mascot for light backgrounds
svg('bo-do-white.svg', bodo('#fff', DEEP))                   # mascot for dark or purple backgrounds
svg('bo-do-wave.svg', bodo(PURPLE, '#fff', INK, 'wave'))     # hello / empty states
svg('bo-do-inspect.svg', bodo(PURPLE, '#fff', INK, 'inspect'), w=156)  # found it / search
svg('bo-do-inspect-white.svg', bodo('#fff', DEEP, pose='inspect'), w=156)  # same, on purple (store images)
svg('bo-do-mono.svg', MASK + f'<g mask="url(#m)">{bodo(INK, INK).replace(TEAL, INK)}</g>')  # one colour: print, stamps
svg('lockup.svg', ICON + WORD.format(c='#1d1420'), w=500)        # icon + name, light backgrounds
svg('lockup-white.svg', ICON + WORD.format(c='#ffffff'), w=500)  # icon + name, dark backgrounds

icon = HERE.parent / 'icons' / 'icon.svg'
icon.write_text('<!-- Source for icon-*.png. Regenerate: see make-icons.sh. Drawn by assets/brand/make-brand.py -->\n'
                + (HERE / 'bo-do-icon.svg').read_text())
