// Public connection settings. The publishable key is safe to ship in a web page:
// what each user can see or change is enforced by database security rules.
export const SUPABASE_URL = 'https://tatuejkauahqsgzwalid.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_J1__8GTEG2cDHKtPYQir9w_lgQALvxt';
export const BUCKET = 'job-files';
export const APP_VERSION = '1.0.1';

// Units that are already a weight. Anything else needs an estimated weight.
export const WEIGHT_UNITS = ['kg', 'tonnes'];
export const QUANTITY_UNITS = [
  ['tonnes', 'Tonnes'], ['kg', 'Kilograms'], ['litres', 'Litres'], ['m3', 'Cubic metres (m³)'],
  ['drums', 'Drums'], ['ibcs', 'IBCs'], ['bags', 'Bags'], ['items', 'Items'], ['loads', 'Loads']
];
export const CONTAINER_TYPES = ['Tanker', 'Drums', 'IBC', 'Skip', 'Bags', 'Bulk bag', 'Wheelie bin', 'Loose'];
export const PHYSICAL_FORMS = [['liquid', 'Liquid'], ['sludge', 'Sludge'], ['solid', 'Solid'], ['powder', 'Powder'], ['mixed', 'Mixed'], ['gas', 'Gas']];

export const STATUS_LABELS = {
  draft: 'Draft', issued: 'Issued', accepted: 'Issued', on_site: 'On site', completed: 'Submitted',
  returned: 'Awaiting review', reviewed: 'Approved', closed: 'Closed', aborted: 'Aborted'
};
