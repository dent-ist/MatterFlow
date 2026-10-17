// Fills a form (task request form, workflow step inputs, asset fields) with plausible values by reading the published schema from the API
// and letting the server validate: values are generated per control, sent to POST /forms/versions/{id}/validate, and fields the server
// rejects are regenerated (another option, a clamped number...) until the form is valid.

import { TEXT_BY_KEY } from './data.mjs';

const INPUT_CONTROLS = new Set([
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'CHECKBOX',
  'SELECT',
  'RADIO',
  'MULTISELECT',
  'DATE',
  'DATETIME',
  'URL',
  'ASSET_REF',
  'USER_REF',
]);

function isoDate(daysFromToday) {
  const d = new Date(Date.now() + daysFromToday * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export class FormFiller {
  /**
   * @param {import('./http.mjs').Api} api
   * @param {ReturnType<import('./rng.mjs').createRng>} rng
   * @param {{ assetIdsFor: (matterId: number, field: object) => number[], userIds: number[] }} refs  candidate values of ASSET_REF and USER_REF fields
   */
  constructor(api, rng, refs) {
    this.api = api;
    this.rng = rng;
    this.refs = refs;
    this.schemas = new Map();
    this.counter = 0;
  }

  async schema(versionId) {
    if (!this.schemas.has(versionId)) {
      this.schemas.set(versionId, this.api.get(`/api/v1/forms/versions/${versionId}/schema`));
    }
    return this.schemas.get(versionId);
  }

  generate(field, matterId, attempt) {
    const rng = this.rng;
    const validation = field.validation ?? {};
    const options = field.options ?? [];
    switch (field.control) {
      case 'TEXT':
      case 'TEXTAREA': {
        this.counter++;
        const hit = TEXT_BY_KEY.find(([pattern]) => pattern.test(field.key));
        let text = hit ? hit[1](this.counter) : `Demo ${field.label ?? field.key}`;
        if (field.control === 'TEXTAREA' && !hit)
          text = `Demo data for ${field.label ?? field.key}.\nSecond line of the demo value.`;
        if (validation.maxLength) text = text.slice(0, validation.maxLength);
        return text;
      }
      case 'URL':
        this.counter++;
        return `https://example.test/demo/${this.counter}`;
      case 'NUMBER': {
        const min = typeof validation.min === 'number' ? validation.min : 1;
        const max =
          typeof validation.max === 'number'
            ? validation.max
            : Math.max(min, /count|records|docs|files/.test(field.key) ? 50_000 : 200);
        return attempt > 0 ? min : rng.int(min, Math.min(max, min + 5000));
      }
      case 'CHECKBOX':
        return rng.chance(0.4);
      case 'SELECT':
      case 'RADIO':
        return options.length
          ? options[(attempt + rng.int(0, options.length - 1)) % options.length].key
          : undefined;
      case 'MULTISELECT': {
        if (!options.length) return undefined;
        const picked = rng.shuffle(options).slice(0, rng.int(1, Math.min(2, options.length)));
        return picked.map((o) => o.key);
      }
      case 'DATE':
        return isoDate(rng.int(-30, 20) + attempt * 40);
      case 'DATETIME':
        return new Date(
          Date.now() - rng.int(1, 14) * 86_400_000 + attempt * 40 * 86_400_000,
        ).toISOString();
      case 'ASSET_REF': {
        const ids = this.refs.assetIdsFor(matterId, field);
        return ids.length ? ids[(attempt + rng.int(0, ids.length - 1)) % ids.length] : undefined;
      }
      case 'USER_REF':
        return this.refs.userIds.length ? rng.pick(this.refs.userIds) : undefined;
      default:
        return undefined;
    }
  }

  /**
   * Returns the form values the server accepts for the form version (empty object when the form has no inputs).
   * Throws with the server's messages when no valid combination was found.
   */
  async fill(versionId, matterId) {
    const schema = await this.schema(versionId);
    const fields = schema.fields.filter((f) => INPUT_CONTROLS.has(f.control));
    if (fields.length === 0) return {};
    const byKey = new Map(fields.map((f) => [f.key, f]));
    const values = {};
    for (const field of fields) {
      const v = this.generate(field, matterId, 0);
      if (v !== undefined) values[field.key] = v;
    }
    let lastErrors = [];
    for (let attempt = 1; attempt <= 8; attempt++) {
      const result = await this.api.post(`/api/v1/forms/versions/${versionId}/validate`, {
        values,
      });
      if (result.isValid) return result.normalizedValues;
      lastErrors = result.errors;
      for (const error of result.errors) {
        const field = byKey.get(error.fieldKey);
        if (!field) continue;
        const next = this.generate(field, matterId, attempt);
        if (next === undefined || attempt >= 5) delete values[field.key];
        else values[field.key] = next;
      }
    }
    throw new Error(
      `No valid values found for form version ${versionId}: ${lastErrors.map((e) => `${e.fieldKey} ${e.code}`).join(', ')}`,
    );
  }
}
