// A tiny invented library for tests (not real company content). Same shape as the real documents and lever records.

export const docs = [
  {
    id: 'd-acme', title: 'Acme Coolers', doc_type: 'case_study', industry: 'Trading',
    sections: [
      { heading: 'Price', summary_en: 'Acme priced from the margin it needed.' },
      { heading: 'Volume', summary_en: 'Acme sold through independent dealers.' },
      { heading: 'Shareholder Strategy', summary_en: 'Founders avoided an equal split.' },
    ],
    full_text: [
      'Acme Coolers - how two brothers built a premium cooler brand',
      'Background of the Founders',
      'Sam and Lee grew up fixing boats. Sam brought distribution accounts and Lee invested about $100,000 from the sale of an earlier business to buy the first three containers of stock.',
      'Price',
      'Acme built its selling price from the margin it needed: a cooler landing at $100 sold at $300, so $100 stayed with the retailer and $100 with Acme. Acme raised the price by 15% when its factory closed, and retailers did not push back.',
      'Volume',
      'Acme sold through independent sporting-goods dealers that large distributors ignored. By 2010 dealers were calling Acme directly and about 10 new dealers were set up each day.',
      'Shareholder Strategy',
      'Avoid 50:50 ownership',
      'Sam and Lee first planned an equal split, but a lawyer advised against structuring the company 50:50 to avoid a deadlock. They settled on Sam 50.5% and Lee 49.5%, and Lee had to buy in with his own money.',
    ].join('\n'),
  },
  {
    id: 'd-beta', title: 'Beta Foods', doc_type: 'case_study', industry: 'Manufacturing (snacks)',
    sections: [
      { heading: 'Volume', summary_en: 'Beta grew through demos and retailer flexibility.' },
      { heading: 'Overhead', summary_en: 'Beta kept fixed costs low.' },
    ],
    full_text: [
      'Beta Foods - a snack brand that grew one store at a time',
      'Volume',
      'Beta ran in-store demonstrations every weekend within a 100 mile radius of its factory, and agreed to unusual pack formats when a big retailer asked, which won shelf space nationwide.',
      'Overhead',
      'Beta used spare factory capacity to make products for other brands, which paid part of the rent. The founders refused outside investors and stayed debt-free, so a 20% fall in sales only wiped out the year\'s profit.',
    ].join('\n'),
  },
  {
    id: 'd-gamma', title: 'Gamma Retail', doc_type: 'case_study', industry: 'Retail',
    sections: [{ heading: 'Talent Strategy', summary_en: 'Gamma used an employee ownership plan.' }],
    full_text: [
      'Gamma Retail - furniture sold at one fair price',
      'Talent Strategy',
      'Gamma moved to an employee ownership plan (ESOP) so staff could slowly buy the company out of yearly profit without bank debt. Gamma never ran sales or discounts.',
    ].join('\n'),
  },
];

export const index = docs.map(({ id, title, doc_type, industry }) => ({ id, title, doc_type, industry }));

export const records = [
  { id: 'r1', doc_id: 'd-acme', doc_title: 'Acme Coolers', lever: 'volume', claim_en: 'Sell through underserved independent dealers: Acme chose dealers that large distributors ignored, building a diversified network.', impact: 'About 10 dealers were set up per day by 2010.', section: 'Volume' },
  { id: 'r2', doc_id: 'd-beta', doc_title: 'Beta Foods', lever: 'volume', claim_en: 'High-touch local activation: demos every weekend within 100 miles of the factory.', impact: 'N/A', section: 'Volume' },
  { id: 'r3', doc_id: 'd-beta', doc_title: 'Beta Foods', lever: 'volume', claim_en: 'Adapt packaging to retailer requests: agreed to unusual pack formats to win shelf space.', impact: 'N/A', section: 'Volume' },
  { id: 'r4', doc_id: 'd-acme', doc_title: 'Acme Coolers', lever: 'others', other_category: 'Shareholder Strategy', claim_en: 'Avoid 50:50 ownership: a lawyer advised against an equal split; Sam held 50.5% and Lee 49.5%.', impact: 'N/A', section: 'Shareholder Strategy' },
  { id: 'r5', doc_id: 'd-gamma', doc_title: 'Gamma Retail', lever: 'others', other_category: 'Talent Strategy', claim_en: 'Employee ownership plan lets staff buy the company from yearly profit without bank debt.', impact: 'N/A', section: 'Talent Strategy' },
];
