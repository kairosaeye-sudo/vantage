import * as cheerio from 'cheerio';

/**
 * Guess the industry of a site that matched no field.
 *
 * Field detection only matches industries we already have fields for. When it
 * fails we still want to know what the business does, so a gap can be recorded
 * as "electricians in Tulsa" rather than "some site".
 *
 * This is deliberately conservative: it returns a label only when the evidence
 * is clear. A wrong industry on a gap report is worse than no industry, because
 * it sends someone off to build the wrong field.
 */

/** Keyword sets per industry, mirroring the field detector's vocabulary but
 *  extending it to trades and services we have no fields for yet. */
const INDUSTRY_VOCAB: Record<string, string[]> = {
  electricians: ['electrician', 'electrical service', 'wiring', 'electrical contractor', 'panel upgrade', 'ev charger'],
  plumbers: ['plumber', 'plumbing', 'drain cleaning', 'water heater', 'sewer line', 'repiping'],
  roofers: ['roofing', 'roofer', 'roof replacement', 'shingle', 'roof repair', 'gutter'],
  hvac: ['hvac', 'air conditioning', 'heating and cooling', 'furnace repair', 'ac repair', 'heat pump'],
  landscapers: ['landscaping', 'lawn care', 'lawn service', 'tree service', 'irrigation', 'hardscaping'],
  painters: ['painting contractor', 'house painting', 'interior painting', 'exterior painting', 'painter'],
  cleaners: ['cleaning service', 'house cleaning', 'maid service', 'janitorial', 'pressure washing', 'carpet cleaning'],
  'pest control': ['pest control', 'exterminator', 'termite', 'rodent control', 'pest management'],
  movers: ['moving company', 'movers', 'local moving', 'long distance moving', 'moving service'],
  'garage doors': ['garage door', 'garage door repair', 'overhead door', 'garage door opener'],
  'pools': ['pool service', 'pool cleaning', 'pool builder', 'swimming pool', 'pool maintenance'],
  'locksmiths': ['locksmith', 'lock repair', 'car lockout', 'rekey'],
  'flooring': ['flooring', 'hardwood floor', 'tile installation', 'carpet installation', 'laminate floor'],
  'window and door': ['window replacement', 'window installation', 'door installation', 'glass repair'],
  'concrete': ['concrete contractor', 'concrete work', 'driveway', 'foundation repair', 'stamped concrete'],
  'fencing': ['fence installation', 'fencing contractor', 'fence repair', 'privacy fence'],
  dentists: ['dentist', 'dental office', 'family dentistry', 'orthodontist', 'dental implants'],
  chiropractors: ['chiropractor', 'chiropractic', 'spinal adjustment', 'back pain treatment'],
  'med spas': ['med spa', 'botox', 'dermal filler', 'laser treatment', 'aesthetics'],
  veterinarians: ['veterinarian', 'veterinary', 'animal hospital', 'pet clinic'],
  'physical therapy': ['physical therapy', 'physiotherapy', 'sports rehab', 'pt clinic'],
  lawyers: ['law firm', 'attorney', 'personal injury lawyer', 'legal services', 'litigation'],
  accountants: ['accounting', 'bookkeeping', 'tax preparation', 'cpa firm', 'payroll services'],
  'real estate': ['real estate agent', 'realtor', 'home buying', 'property listing', 'realty'],
  'auto repair': ['auto repair', 'mechanic', 'car service', 'oil change', 'brake repair'],
  'hair salons': ['hair salon', 'barbershop', 'haircut', 'stylist', 'beauty salon'],
  restaurants: ['restaurant', 'menu', 'dine in', 'takeout', 'reservations', 'our kitchen'],
  'coffee shops': ['coffee shop', 'espresso', 'roastery', 'cafe'],
  gyms: ['gym', 'fitness studio', 'personal training', 'crossfit', 'yoga studio'],
  'pet services': ['dog grooming', 'pet sitting', 'dog walking', 'pet boarding', 'doggy daycare'],
};

export interface IndustryGuess {
  industry: string | null;
  /** The keyword that produced the match. */
  evidence: string | null;
  /** How many distinct keywords matched — more means more confidence. */
  strength: number;
}

export function guessIndustry(html: string): IndustryGuess {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();

  // Title and headings carry more signal than body text.
  const title = ($('title').first().text() || '').toLowerCase();
  const headings = $('h1, h2')
    .map((_, el) => $(el).text())
    .get()
    .join(' ')
    .toLowerCase();
  const body = $('body').text().replace(/\s+/g, ' ').toLowerCase();

  let best: IndustryGuess = { industry: null, evidence: null, strength: 0 };

  for (const [industry, keywords] of Object.entries(INDUSTRY_VOCAB)) {
    let strength = 0;
    let evidence: string | null = null;

    for (const kw of keywords) {
      if (title.includes(kw) || headings.includes(kw)) {
        strength += 3;
        evidence = evidence ?? kw;
      } else if (body.includes(kw)) {
        strength += 1;
        evidence = evidence ?? kw;
      }
    }

    if (strength > best.strength) {
      best = { industry, evidence, strength };
    }
  }

  // Require a real match — a single body-text hit is too weak to act on.
  if (best.strength < 3) {
    return { industry: null, evidence: best.evidence, strength: best.strength };
  }
  return best;
}
