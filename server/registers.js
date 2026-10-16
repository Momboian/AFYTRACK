// Register definitions shared by the generic register API.
// Each register maps to a table; `fields` lists the writable columns and validation rules.

const STATUS3 = ['unknown', 'satisfactory', 'needs_improvement', 'unsatisfactory'];

export const REGISTERS = {
  premises: {
    table: 'food_premises',
    label: 'Food premises',
    nameField: 'premises_name',
    search: ['premises_name', 'premises_type', 'licence_number', 'owner_name'],
    duplicateCheck: true,
    restricted: ['owner_name', 'contact_phone'],
    fields: {
      premises_name: { required: true, label: 'Premises name' },
      premises_type: {},
      location_id: { type: 'int' },
      owner_name: {},
      contact_phone: {},
      licence_status: { enum: ['unknown', 'valid', 'expired', 'pending', 'not_licensed'] },
      licence_number: {},
      licence_issue_date: { type: 'date' },
      licence_expiry_date: { type: 'date' },
      assigned_officer_id: { type: 'int' },
      notes: {},
      active: { type: 'bool' }
    }
  },
  handler: {
    table: 'food_handlers',
    label: 'Food handlers',
    nameField: 'name',
    search: ['name', 'identifier'],
    restricted: ['identifier'],
    fields: {
      name: { required: true, label: 'Name' },
      identifier: {},
      premises_id: { type: 'int' },
      medical_exam_date: { type: 'date' },
      certificate_expiry: { type: 'date' },
      status: { enum: ['unknown', 'current', 'pending', 'expired'] },
      notes: {},
      active: { type: 'bool' }
    }
  },
  household: {
    table: 'households',
    label: 'Households',
    nameField: 'household_code',
    search: ['household_code', 'sanitation_type'],
    fields: {
      household_code: { required: true, label: 'Household code' },
      location_id: { type: 'int' },
      sanitation_type: {},
      sanitation_status: { enum: ['unknown', 'adequate', 'needs_improvement', 'inadequate', 'none'] },
      last_visit_date: { type: 'date' },
      follow_up_due: { type: 'date' },
      assigned_officer_id: { type: 'int' },
      notes: {},
      active: { type: 'bool' }
    }
  },
  water_source: {
    table: 'water_sources',
    label: 'Water sources',
    nameField: 'source_name',
    search: ['source_name', 'source_code', 'source_type', 'operator'],
    duplicateCheck: true,
    fields: {
      source_name: { required: true, label: 'Source name' },
      source_code: {},
      source_type: {},
      location_id: { type: 'int' },
      operator: {},
      status: { enum: ['unknown', 'functional', 'needs_attention', 'non_functional', 'closed'] },
      last_inspection_date: { type: 'date' },
      next_inspection_due: { type: 'date' },
      assigned_officer_id: { type: 'int' },
      notes: {},
      active: { type: 'bool' }
    }
  },
  facility: {
    table: 'healthcare_facilities',
    label: 'Healthcare facilities',
    nameField: 'facility_name',
    search: ['facility_name', 'facility_type', 'facility_code'],
    duplicateCheck: true,
    fields: {
      facility_name: { required: true, label: 'Facility name' },
      facility_type: {},
      facility_code: {},
      location_id: { type: 'int' },
      water_supply_status: { enum: STATUS3 },
      toilet_status: { enum: STATUS3 },
      drainage_status: { enum: STATUS3 },
      cleaning_status: { enum: STATUS3 },
      waste_management_status: { enum: STATUS3 },
      incinerator_status: { enum: ['unknown', 'functional', 'partially_functional', 'non_functional', 'not_available'] },
      pest_control_status: { enum: STATUS3 },
      assigned_officer_id: { type: 'int' },
      notes: {},
      active: { type: 'bool' }
    }
  }
};

export const ENTITY_TYPES = Object.keys(REGISTERS);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Validate and clean an input body against a field spec. Returns { data, errors }.
export function cleanFields(spec, body, { partial = false } = {}) {
  const data = {};
  const errors = {};
  for (const [key, rule] of Object.entries(spec)) {
    if (!(key in body)) {
      if (!partial && rule.required) errors[key] = `${rule.label || key} is required so the record can be identified.`;
      continue;
    }
    let v = body[key];
    if (v === '' || v === undefined) v = null;
    if (v === null) {
      if (rule.required) errors[key] = `${rule.label || key} is required so the record can be identified.`;
      data[key] = null;
      continue;
    }
    if (rule.type === 'int') {
      const n = Number(v);
      if (!Number.isInteger(n)) { errors[key] = 'Must be a whole number.'; continue; }
      v = n;
    } else if (rule.type === 'bool') {
      v = v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
    } else if (rule.type === 'date') {
      if (!isValidDate(String(v))) { errors[key] = 'Enter a valid date (YYYY-MM-DD).'; continue; }
    } else if (rule.type === 'number') {
      const n = Number(v);
      if (Number.isNaN(n)) { errors[key] = 'Must be a number.'; continue; }
      v = n;
    } else {
      v = String(v).trim().slice(0, 4000);
    }
    if (rule.enum && !rule.enum.includes(v)) { errors[key] = `Choose one of: ${rule.enum.join(', ')}.`; continue; }
    data[key] = v;
  }
  return { data, errors };
}
