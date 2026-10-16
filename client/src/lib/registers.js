// Client side register definitions: drive list columns, filters and forms.
const STATUS3 = ['unknown', 'satisfactory', 'needs_improvement', 'unsatisfactory'];

export const REGISTERS = {
  premises: {
    label: 'Food premises', singular: 'Food premises', nameField: 'premises_name', statusField: 'licence_status',
    statusOptions: ['unknown', 'valid', 'expired', 'pending', 'not_licensed'],
    columns: [
      { key: 'premises_name', label: 'Name' }, { key: 'premises_type', label: 'Type' }, { key: 'sub_location', label: 'Sub location' },
      { key: 'licence_status', label: 'Licence', badge: true }, { key: 'licence_expiry_date', label: 'Licence expiry', date: true, expiry: true },
      { key: 'last_inspection', label: 'Last inspection', date: true }, { key: 'open_follow_ups', label: 'Open follow ups', num: true }
    ],
    form: [
      { key: 'premises_name', label: 'Premises name', required: true },
      { key: 'premises_type', label: 'Premises type', options: ['Restaurant', 'Hotel', 'Cafe', 'Bakery', 'Butchery', 'Fish kiosk', 'Dairy outlet', 'Supermarket', 'Grocery', 'Other'] },
      { key: 'location_id', label: 'Location', type: 'location' },
      { key: 'assigned_officer_id', label: 'Assigned officer', type: 'officer' },
      { section: 'Owner / contact (restricted)', hint: 'Only record what is needed to contact the operator.' },
      { key: 'owner_name', label: 'Owner / operator name' }, { key: 'contact_phone', label: 'Contact phone' },
      { section: 'Licence' },
      { key: 'licence_status', label: 'Licence status', options: ['unknown', 'valid', 'expired', 'pending', 'not_licensed'] },
      { key: 'licence_number', label: 'Licence number' },
      { key: 'licence_issue_date', label: 'Issue date', type: 'date' }, { key: 'licence_expiry_date', label: 'Expiry date', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  handler: {
    label: 'Food handlers', singular: 'Food handler', nameField: 'name', statusField: 'status',
    statusOptions: ['unknown', 'current', 'pending', 'expired'],
    columns: [
      { key: 'name', label: 'Name / identifier' }, { key: 'identifier', label: 'ID' }, { key: 'premises_name', label: 'Premises' },
      { key: 'medical_exam_date', label: 'Medical exam', date: true }, { key: 'certificate_expiry', label: 'Certificate expiry', date: true, expiry: true },
      { key: 'status', label: 'Status', badge: true }
    ],
    form: [
      { key: 'name', label: 'Name or approved identifier', required: true, hint: 'Do not record clinical details.' },
      { key: 'identifier', label: 'Reference / ID' },
      { key: 'premises_id', label: 'Works at premises', type: 'premises' },
      { key: 'medical_exam_date', label: 'Medical examination date', type: 'date' },
      { key: 'certificate_expiry', label: 'Certificate expiry', type: 'date', hint: 'If left blank, status is shown as not recorded (never assumed valid).' },
      { key: 'status', label: 'Status', options: ['unknown', 'current', 'pending', 'expired'] },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  household: {
    label: 'Households', singular: 'Household', nameField: 'household_code', statusField: 'sanitation_status',
    statusOptions: ['unknown', 'adequate', 'needs_improvement', 'inadequate', 'none'],
    columns: [
      { key: 'household_code', label: 'Household code' }, { key: 'sub_location', label: 'Sub location' }, { key: 'village', label: 'Village' },
      { key: 'sanitation_type', label: 'Sanitation type' }, { key: 'sanitation_status', label: 'Status', badge: true },
      { key: 'last_visit_date', label: 'Last visit', date: true }, { key: 'follow_up_due', label: 'Follow up due', date: true, due: true }
    ],
    form: [
      { key: 'household_code', label: 'Household code', required: true, hint: 'Local identifier. Avoid resident names.' },
      { key: 'location_id', label: 'Location', type: 'location' },
      { key: 'sanitation_type', label: 'Sanitation type', options: ['Pit latrine', 'VIP latrine', 'Pour flush', 'Flush toilet', 'Shared latrine', 'None', 'Other'] },
      { key: 'sanitation_status', label: 'Sanitation status', options: ['unknown', 'adequate', 'needs_improvement', 'inadequate', 'none'] },
      { key: 'last_visit_date', label: 'Last visit date', type: 'date' }, { key: 'follow_up_due', label: 'Follow up due', type: 'date' },
      { key: 'assigned_officer_id', label: 'Assigned officer', type: 'officer' },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  water_source: {
    label: 'Water sources', singular: 'Water source', nameField: 'source_name', statusField: 'status',
    statusOptions: ['unknown', 'functional', 'needs_attention', 'non_functional', 'closed'],
    columns: [
      { key: 'source_name', label: 'Source' }, { key: 'source_type', label: 'Type' }, { key: 'sub_location', label: 'Sub location' },
      { key: 'status', label: 'Status', badge: true }, { key: 'last_inspection_date', label: 'Last inspection', date: true },
      { key: 'next_inspection_due', label: 'Next inspection', date: true, due: true }
    ],
    form: [
      { key: 'source_name', label: 'Source name', required: true }, { key: 'source_code', label: 'Source code' },
      { key: 'source_type', label: 'Source type', options: ['Borehole', 'Shallow well', 'Protected spring', 'Water kiosk', 'Piped supply', 'Dam / pan', 'Rain water tank', 'River', 'Other'] },
      { key: 'location_id', label: 'Location', type: 'location' }, { key: 'operator', label: 'Owner / operator' },
      { key: 'status', label: 'Status', options: ['unknown', 'functional', 'needs_attention', 'non_functional', 'closed'] },
      { key: 'last_inspection_date', label: 'Last inspection', type: 'date' }, { key: 'next_inspection_due', label: 'Next inspection due', type: 'date' },
      { key: 'assigned_officer_id', label: 'Assigned officer', type: 'officer' }, { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  },
  facility: {
    label: 'Healthcare facilities', singular: 'Healthcare facility', nameField: 'facility_name', statusField: 'incinerator_status',
    statusOptions: ['unknown', 'functional', 'partially_functional', 'non_functional', 'not_available'],
    columns: [
      { key: 'facility_name', label: 'Facility' }, { key: 'facility_type', label: 'Type' }, { key: 'sub_location', label: 'Sub location' },
      { key: 'waste_management_status', label: 'Waste mgmt', badge: true }, { key: 'incinerator_status', label: 'Incinerator', badge: true },
      { key: 'last_inspection', label: 'Last inspection', date: true }, { key: 'open_follow_ups', label: 'Open actions', num: true }
    ],
    form: [
      { key: 'facility_name', label: 'Facility name', required: true },
      { key: 'facility_type', label: 'Facility type', options: ['Hospital', 'Health centre', 'Dispensary', 'Private clinic', 'Maternity home', 'Laboratory', 'Other'] },
      { key: 'facility_code', label: 'Facility code (MFL)' }, { key: 'location_id', label: 'Location', type: 'location' },
      { key: 'assigned_officer_id', label: 'Assigned officer', type: 'officer' },
      { section: 'Current sanitation status', hint: 'Updated from the latest inspection. Use unknown if not assessed.' },
      { key: 'water_supply_status', label: 'Water supply', options: STATUS3 }, { key: 'toilet_status', label: 'Toilets', options: STATUS3 },
      { key: 'drainage_status', label: 'Drainage', options: STATUS3 }, { key: 'cleaning_status', label: 'Cleaning', options: STATUS3 },
      { key: 'waste_management_status', label: 'Waste segregation / disposal', options: STATUS3 },
      { key: 'incinerator_status', label: 'Incinerator / burning chamber', options: ['unknown', 'functional', 'partially_functional', 'non_functional', 'not_available'] },
      { key: 'pest_control_status', label: 'Pest control', options: STATUS3 },
      { key: 'notes', label: 'Notes', type: 'textarea' }
    ]
  }
};

export const REGISTER_KEYS = Object.keys(REGISTERS);
export const FACILITY_STATUS_FIELDS = REGISTERS.facility.form.filter((f) => f.key && f.key.endsWith('_status'));
