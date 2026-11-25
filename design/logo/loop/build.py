import os
OUT=os.path.dirname(os.path.abspath(__file__))
INDIGO="#2B2F8F"; NIGHT="#15162B"; WHITE="#FFFFFF"; LILAC="#9EA2FF"
SLANT="skewX(-10)"
# Symbol, regular cut (33 px and up). Unslanted drawing, slanted about the baseline y=186.
REG=dict(w=26, d="M62 186C102 186 156 150 156 100C156 71 138 56 119 56C98 56 84 74 84 98C84 148 126 186 170 186", dot=(212,186,15.5))
# Small cut (32 px and below): heavier stroke, rounder counter, wider gap before the dot.
SMALL=dict(w=34, d="M56 188C98 188 162 150 162 100C162 66 140 50 119 50C94 50 78 70 78 98C78 150 122 188 164 188", dot=(214,188,19))
def mark(cut, color, dx=0, dy=0):
    x,y,r=cut["dot"]
    return (f'<g transform="translate({dx} {dy}) translate(0 186) {SLANT} translate(0 -186)">'
            f'<path d="{cut["d"]}" fill="none" stroke="{color}" stroke-width="{cut["w"]}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="{x}" cy="{y}" r="{r}" fill="{color}"/></g>')
# Centre the regular mark: measured bbox after slant is roughly x 44..228, y 43..202 -> shift to centre.
REG_SHIFT=(-17,-2); SMALL_SHIFT=(-16,-1)
def svg(vb, body, title="Jot"):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"><title>{title}</title>{body}</svg>\n'
def save(name, s):
    open(os.path.join(OUT,name),"w").write(s)
# Wordmark "jot", monoline in the symbol's slant; baseline 210, x-height 100..210.
WM_W=22
def wordmark(color, dx=0, dy=0):
    return (f'<g transform="translate({dx} {dy}) translate(0 210) {SLANT} translate(0 -210)" fill="none" stroke="{color}" stroke-width="{WM_W}" stroke-linecap="round" stroke-linejoin="round">'
            f'<path d="M44 104V214C44 240 30 252 12 252"/>'
            f'<ellipse cx="118" cy="157" rx="42" ry="53"/>'
            f'<path d="M200 66V178C200 198 210 208 228 208M176 106H230"/>'
            f'<circle cx="44" cy="66" r="14" fill="{color}" stroke="none"/></g>')
for name,color in [("symbol",INDIGO),("symbol-black","#000"),("symbol-white",WHITE)]:
    save(f"jot-{name}.svg", svg("0 0 256 256", mark(REG,color,*REG_SHIFT)))
save("jot-symbol-small.svg", svg("0 0 256 256", mark(SMALL,INDIGO,*SMALL_SHIFT)))
save("jot-symbol-small-black.svg", svg("0 0 256 256", mark(SMALL,"#000",*SMALL_SHIFT)))
for name,color in [("wordmark",INDIGO),("wordmark-black","#000"),("wordmark-white",WHITE)]:
    save(f"jot-{name}.svg", svg("0 30 262 252", wordmark(color, 4, 0)))
# Horizontal lockup: symbol 256 + wordmark scaled to sit on the symbol's baseline.
def horizontal(sym, word):
    return svg("0 0 453 256", mark(REG,sym,*REG_SHIFT) + f'<g transform="translate(244 45) scale(0.66)">{wordmark(word)}</g>')
save("jot-horizontal.svg", horizontal(INDIGO, NIGHT))
save("jot-horizontal-white.svg", horizontal(WHITE, WHITE))
save("jot-stacked.svg", svg("0 16 300 394", f'<g transform="translate(22 10)">{mark(REG,INDIGO,*REG_SHIFT)}</g><g transform="translate(66 200) scale(0.66)">{wordmark(NIGHT)}</g>'))
# App icons. Full-bleed 256 grid, and macOS 824-on-1024 tile.
def tile(bg, fg, cut, shift, full=True):
    if full:
        return svg("0 0 256 256", f'<rect width="256" height="256" rx="56" fill="{bg}"/><g transform="translate(26 26) scale(0.797)">{mark(cut,fg,*shift)}</g>')
    return svg("0 0 1024 1024", f'<rect x="100" y="100" width="824" height="824" rx="185" fill="{bg}"/><g transform="translate(140.8 140.8) scale(2.9)">{mark(cut,fg,*shift)}</g>')
save("jot-app-icon.svg", tile(INDIGO, WHITE, REG, REG_SHIFT))
save("jot-app-icon-small.svg", tile(INDIGO, WHITE, SMALL, SMALL_SHIFT))
save("jot-macos-icon.svg", tile(INDIGO, WHITE, REG, REG_SHIFT, full=False))
save("jot-macos-icon-small.svg", tile(INDIGO, WHITE, SMALL, SMALL_SHIFT, full=False))
save("jot-macos-icon-dark.svg", tile(NIGHT, LILAC, REG, REG_SHIFT, full=False))
# Menu-bar template: black on clear, small cut, edge to edge.
save("jot-tray-template.svg", svg("0 0 256 256", f'<g transform="translate(-6 0) scale(1.08) translate(-4 -6)">{mark(SMALL,"#000",*SMALL_SHIFT)}</g>'))
print("ok")
