import type { Finish } from '../color/solve.ts';

/**
 * Reference colour library for search. Colours are approximate representations of common
 * automotive colour names, not OEM paint codes or manufacturer formulas.
 */
export interface NamedColour { name: string; hex: string; finish: Finish; tags: string }

const c = (name: string, hex: string, finish: Finish, tags = ''): NamedColour => ({ name, hex, finish, tags });

export const COLOURS: NamedColour[] = [
  // blacks, whites, greys
  c('Jet black', '#0b0b0c', 'solid', 'black gloss piano'),
  c('Matte black', '#1a1a1b', 'matte', 'black flat stealth'),
  c('Satin black', '#141416', 'satin', 'black'),
  c('Pure white', '#f4f4f2', 'solid', 'white'),
  c('Off white', '#ece8df', 'solid', 'white cream ivory'),
  c('Pearl white', '#ece9e0', 'pearl', 'white tri-coat'),
  c('Chalk grey', '#c8c7c2', 'solid', 'grey gray light'),
  c('Cement grey', '#8c8d8a', 'solid', 'grey gray concrete'),
  c('Flat track grey', '#7d807f', 'solid', 'grey gray non-metallic modern'),
  c('Battleship grey', '#6e7378', 'solid', 'grey gray navy'),
  c('Gunmetal', '#3b3f44', 'metallic', 'grey gray dark charcoal'),
  c('Charcoal metallic', '#2e3034', 'metallic', 'grey gray dark'),
  c('Silver metallic', '#b9bcc0', 'metallic', 'silver grey'),
  c('Liquid silver', '#c9ccd0', 'metallic', 'silver chrome bright'),
  // reds
  c('Black cherry', '#3a0b16', 'pearl', 'red dark cherry wine burgundy'),
  c('Candy apple red', '#a3000f', 'candy', 'red candy kandy'),
  c('Racing red', '#c4141c', 'solid', 'red bright'),
  c('Signal red', '#b5121b', 'solid', 'red'),
  c('Ruby red', '#8a0f22', 'metallic', 'red jewel'),
  c('Wine red', '#5e1526', 'pearl', 'red burgundy merlot'),
  c('Burgundy', '#5a1222', 'metallic', 'red maroon oxblood'),
  c('Maroon', '#5b1a1a', 'solid', 'red brown'),
  c('Brick red', '#8e3426', 'solid', 'red oxide terracotta'),
  // oranges, yellows, golds
  c('Safety orange', '#e8590c', 'solid', 'orange bright'),
  c('Burnt orange', '#b5501c', 'metallic', 'orange copper'),
  c('Sunset orange', '#d9631f', 'pearl', 'orange'),
  c('Racing yellow', '#f5c400', 'solid', 'yellow bright'),
  c('Sunflower yellow', '#f2c014', 'solid', 'yellow'),
  c('Mustard', '#c79a1d', 'solid', 'yellow ochre'),
  c('Gold metallic', '#b8902f', 'metallic', 'gold yellow'),
  c('Champagne', '#c9b48e', 'metallic', 'gold beige'),
  c('Bronze', '#7a5a3a', 'metallic', 'brown copper'),
  c('Copper', '#9a5634', 'metallic', 'orange brown'),
  c('Rose gold', '#c99a86', 'metallic', 'pink gold'),
  // greens
  c('British racing green', '#0f3b25', 'solid', 'green dark brg'),
  c('Forest green', '#1f3d2b', 'metallic', 'green dark'),
  c('Emerald green', '#0b6b3f', 'metallic', 'green jewel'),
  c('Lime green', '#8cc63f', 'solid', 'green bright acid'),
  c('Olive drab', '#4b5320', 'matte', 'green military army'),
  c('Military green', '#4a5b3e', 'matte', 'green army'),
  c('Mint green', '#9fd8c1', 'solid', 'green pastel'),
  c('Teal metallic', '#1c6f78', 'metallic', 'green blue cyan'),
  c('Candy teal', '#0a6a70', 'candy', 'green blue kandy'),
  // blues
  c('Navy blue', '#1b2a4a', 'solid', 'blue dark'),
  c('Midnight blue', '#141c33', 'metallic', 'blue dark night'),
  c('Royal blue', '#1f3fa0', 'solid', 'blue'),
  c('Electric blue', '#1460d8', 'pearl', 'blue bright'),
  c('Petrol blue', '#1f4e5f', 'metallic', 'blue teal'),
  c('Sky blue', '#7fb3df', 'solid', 'blue light'),
  c('Baby blue', '#a8c8e8', 'solid', 'blue pastel'),
  c('Candy cobalt', '#0d2a8a', 'candy', 'blue kandy'),
  // purples, pinks
  c('Midnight purple', '#2a1640', 'pearl', 'purple violet dark'),
  c('Plum', '#4a1d3d', 'metallic', 'purple'),
  c('Lavender', '#a596c8', 'solid', 'purple pastel lilac'),
  c('Hot pink', '#e0408a', 'solid', 'pink magenta'),
  c('Candy magenta', '#8a0f4f', 'candy', 'pink purple kandy'),
  // browns, beiges
  c('Chocolate brown', '#3e2720', 'metallic', 'brown dark'),
  c('Coffee', '#5a3f2e', 'solid', 'brown'),
  c('Sand beige', '#cdb894', 'solid', 'beige tan'),
  c('Desert tan', '#b9a37e', 'matte', 'beige tan military'),
];

const norm = (s: string) => s.toLowerCase().replace(/gray/g, 'grey').replace(/colou?r/g, '').trim();

/** Rank colours by how well their name and tags match the query words. */
export function searchColours(query: string, limit = 8): NamedColour[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return COLOURS.map((x) => {
    const name = norm(x.name), tags = norm(x.tags) + ' ' + x.finish;
    let score = 0;
    for (const w of words) {
      if (name.split(' ').some((n) => n === w)) score += 3;
      else if (name.includes(w)) score += 2;
      else if (tags.split(' ').some((t) => t.startsWith(w))) score += 1;
      else return { x, score: 0 };
    }
    if (name === words.join(' ')) score += 5;
    return { x, score };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((r) => r.x);
}
