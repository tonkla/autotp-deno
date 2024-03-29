import { testing } from '../deps.ts'

import { camelize } from './camelize.js'

Deno.test('camelize', () => {
  const input = {
    best_chili: {
      chili_ingredients: [
        'beef',
        'dried chilis',
        'fresh tomatoes',
        'cumin',
        'onions',
        'onion-powder',
        'peppers',
      ],
      chili_steps: { step_1: '', step_2: '' },
    },
    serves: 6,
    pairs_with: [{ 'french-bread': {} }, { 'rye-croutons': {} }],
  }

  const expected = {
    bestChili: {
      chiliIngredients: [
        'beef',
        'dried chilis',
        'fresh tomatoes',
        'cumin',
        'onions',
        'onion-powder',
        'peppers',
      ],
      chiliSteps: { step_1: '', step_2: '' },
    },
    serves: 6,
    pairsWith: [{ frenchBread: {} }, { ryeCroutons: {} }],
  }

  testing.assertEquals(camelize(input), expected)
})
