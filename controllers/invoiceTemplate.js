const getInvoiceTemplate = (data) => {
  const {
    invoiceNumber,
    issueDate,
    dueDate,
    client = {},
    billingPeriod = {},
    items = [],
    subtotal = 0,
    discount = { type: 'flat', value: 0, amount: 0 },
    taxes = [],
    total = 0,
    amountPaid = 0,
    balanceDue = 0,
    notes = ''
  } = data || {};

  const fmt = (n) => (typeof n === 'number' ? `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '₹0.00');
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');

  const template = {
    content: [
      { text: 'OFIS SQUARE PRIVATE LIMITED', style: 'brand' },
      { text: 'Invoice', style: 'title', margin: [0, 4, 0, 20] },

      {
        columns: [
          [
            { text: 'BILL TO', style: 'sectionHeader' },
            { text: client.companyName || '—', margin: [0, 4, 0, 0] },
            { text: client.contactPerson ? `Attn: ${client.contactPerson}` : '', margin: [0, 2, 0, 0] },
            { text: client.email || '', margin: [0, 2, 0, 0] },
            { text: client.phone || '', margin: [0, 2, 0, 0] },
            { text: client.companyAddress || '', margin: [0, 2, 0, 0] },
          ],
          [
            { text: `Invoice # ${invoiceNumber || '—'}`, style: 'kv' },
            { text: `Issue Date: ${fmtDate(issueDate)}`, style: 'kv' },
            { text: `Due Date: ${fmtDate(dueDate)}`, style: 'kv' },
            { text: `Billing: ${fmtDate(billingPeriod.start)} - ${fmtDate(billingPeriod.end)}`, style: 'kv' },
          ],
        ],
        margin: [0, 0, 0, 16],
      },

      {
        table: {
          headerRows: 1,
          widths: ['*', 50, 80, 80],
          body: [
            [
              { text: 'Description', style: 'th' },
              { text: 'Qty', style: 'th', alignment: 'right' },
              { text: 'Unit Price', style: 'th', alignment: 'right' },
              { text: 'Amount', style: 'th', alignment: 'right' },
            ],
            ...items.map((it) => ([
              { text: it.description || '', style: 'td' },
              { text: String(it.quantity ?? ''), alignment: 'right', style: 'td' },
              { text: fmt(it.unitPrice ?? 0), alignment: 'right', style: 'td' },
              { text: fmt(it.amount ?? (Number(it.quantity||0)*Number(it.unitPrice||0))), alignment: 'right', style: 'td' },
            ])),
          ],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 12],
      },

      {
        columns: [
          [
            { text: 'Notes', style: 'sectionHeader' },
            { text: notes || '—', margin: [0, 6, 0, 0] },
          ],
          {
            width: 220,
            table: {
              widths: ['*', 90],
              body: [
                ['Subtotal', { text: fmt(subtotal), alignment: 'right' }],
                [
                  'Discount',
                  { text: `${discount?.type === 'percent' ? discount.value + '%' : ''} ${fmt(discount?.amount || 0)}`, alignment: 'right' },
                ],
                ...taxes.map((t) => ([ t.name || 'Tax', { text: fmt(t.amount || 0), alignment: 'right' } ])),
                [{ text: 'Total', bold: true }, { text: fmt(total), alignment: 'right', bold: true }],
                ['Amount Paid', { text: fmt(amountPaid), alignment: 'right' }],
                [{ text: 'Balance Due', bold: true }, { text: fmt(balanceDue), alignment: 'right', bold: true }],
              ],
            },
            layout: 'lightHorizontalLines',
          },
        ],
        margin: [0, 0, 0, 20],
      },

      { text: 'Thank you for your business.', alignment: 'center', margin: [0, 20, 0, 0], italics: true },
    ],

    styles: {
      brand: { fontSize: 14, bold: true, alignment: 'center' },
      title: { fontSize: 18, bold: true, alignment: 'center', color: '#2d3e50' },
      sectionHeader: { fontSize: 10, bold: true, color: '#2d3e50' },
      kv: { fontSize: 10, margin: [0, 2, 0, 0] },
      th: { bold: true, fillColor: '#f0f0f0' },
      td: {},
    },
    defaultStyle: { fontSize: 10, font: 'Helvetica' },
    pageMargins: [40, 40, 40, 40],
  };

  return template;
};

export default getInvoiceTemplate;
