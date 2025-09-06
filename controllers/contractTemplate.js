const getContractTemplate = (contractData) => {
  const {
    companyName,
    contactPerson,
    email,
    phone,
    companyAddress,
    cabinName,
    cabinCapacity,
    monthlyRent,
    securityDeposit,
    contractStartDate,
    contractEndDate,
    terms,
    clientSignature,
    adminSignature
  } = contractData;

  const template = {
    content: [
      // Header
      {
        stack: [
          {
            text: "OFIS SQUARE PRIVATE LIMITED",
            fontSize: 16,
            bold: true,
            alignment: 'center',
            margin: [0, 0, 0, 5],
          },
          {
            text: "1 Floor, Ofis Square, The Iconic Corenthum,\nSector 62, Noida, GAUTAM BUDDHA NAGAR, \nUttar Pradesh - 201301, India",
            fontSize: 9,
            alignment: 'center',
            margin: [0, 5, 0, 20],
          },
        ],
      },

      // Title
      { 
        text: 'OFFICE SPACE RENTAL AGREEMENT', 
        style: 'title',
        margin: [0, 20, 0, 30],
      },

      // Agreement Introduction
      {
        text: [
          'This Office Space Rental Agreement ("Agreement") is entered into on ',
          { text: contractStartDate || '___________', bold: true },
          ' between OFIS SQUARE PRIVATE LIMITED, a company incorporated under the Companies Act, 2013 ("Lessor") and ',
          { text: companyName || '___________', bold: true },
          ' ("Lessee").'
        ],
        margin: [0, 0, 0, 20],
        alignment: 'justify'
      },

      // Company Details Section
      {
        stack: [
          {
            table: {
              widths: ['100%'],
              body: [
                [{ text: 'Lessee Details', style: 'sectionHeader', fillColor: '#f0f0f0' }]
              ]
            },
            layout: {
              hLineWidth: function(i, node) { return 0; },
              vLineWidth: function(i, node) { return 0; },
              paddingTop: function(i, node) { return 8; },
              paddingBottom: function(i, node) { return 8; },
            }
          },
          {
            table: {
              widths: ['30%', '70%'],
              body: [
                ['Company Name', { text: companyName || '', bold: false }],
                ['Contact Person', { text: contactPerson || '', bold: false }],
                ['Email', { text: email || '', bold: false }],
                ['Phone', { text: phone || '', bold: false }],
                ['Address', { text: companyAddress || '', bold: false }],
              ]
            },
            layout: 'lightHorizontalLines',
            margin: [0, 0, 0, 20]
          },
        ]
      },

      // Rental Details Section
      {
        stack: [
          {
            table: {
              widths: ['100%'],
              body: [
                [{ text: 'Rental Details', style: 'sectionHeader', fillColor: '#f0f0f0' }]
              ]
            },
            layout: {
              hLineWidth: function(i, node) { return 0; },
              vLineWidth: function(i, node) { return 0; },
              paddingTop: function(i, node) { return 8; },
              paddingBottom: function(i, node) { return 8; },
            }
          },
          {
            table: {
              widths: ['30%', '70%'],
              body: [
                ['Cabin/Office', { text: cabinName || '', bold: false }],
                ['Capacity', { text: cabinCapacity ? `${cabinCapacity} persons` : '', bold: false }],
                ['Monthly Rent', { text: monthlyRent ? `₹${monthlyRent.toLocaleString()}` : '', bold: false }],
                ['Security Deposit', { text: securityDeposit ? `₹${securityDeposit.toLocaleString()}` : '', bold: false }],
                ['Contract Start Date', { text: contractStartDate || '', bold: false }],
                ['Contract End Date', { text: contractEndDate || '', bold: false }],
              ]
            },
            layout: 'lightHorizontalLines',
            margin: [0, 0, 0, 20]
          },
        ]
      },

      // Terms and Conditions
      {
        stack: [
          {
            table: {
              widths: ['100%'],
              body: [
                [{ text: 'Terms and Conditions', style: 'sectionHeader', fillColor: '#f0f0f0' }]
              ]
            },
            layout: {
              hLineWidth: function(i, node) { return 0; },
              vLineWidth: function(i, node) { return 0; },
              paddingTop: function(i, node) { return 8; },
              paddingBottom: function(i, node) { return 8; },
            }
          },
          {
            ol: [
              'The Lessee agrees to pay the monthly rent on or before the 5th of each month.',
              'The security deposit shall be refunded within 30 days of contract termination, subject to deductions for any damages.',
              'The Lessee shall use the premises solely for office purposes and shall not sublet without written consent.',
              'The Lessee is responsible for maintaining the cleanliness and proper use of the allocated space.',
              'Either party may terminate this agreement with 30 days written notice.',
              'The Lessee shall comply with all building rules and regulations.',
              'Any modifications to the premises require prior written approval from the Lessor.',
              'The Lessee shall be liable for any damages caused to the property during the tenancy period.',
              ...(terms ? [terms] : [])
            ],
            margin: [0, 0, 0, 30]
          },
        ]
      },

      // Signatures Section
      {
        columns: [
          {
            width: '50%',
            stack: [
              { text: 'Lessor Signature', style: 'signatureHeader' },
              { text: '\n\n\n', fontSize: 12 },
              { text: '________________________', alignment: 'center' },
              { text: 'OFIS SQUARE PRIVATE LIMITED', alignment: 'center', fontSize: 10, margin: [0, 5, 0, 0] },
              { text: 'Date: ___________', alignment: 'center', fontSize: 10, margin: [0, 10, 0, 0] }
            ]
          },
          {
            width: '50%',
            stack: [
              { text: 'Lessee Signature', style: 'signatureHeader' },
              { text: '\n\n\n', fontSize: 12 },
              { text: '________________________', alignment: 'center' },
              { text: companyName || '___________', alignment: 'center', fontSize: 10, margin: [0, 5, 0, 0] },
              { text: 'Date: ___________', alignment: 'center', fontSize: 10, margin: [0, 10, 0, 0] }
            ]
          }
        ],
        margin: [0, 30, 0, 0]
      },

      // Footer
      {
        text: 'This agreement is governed by the laws of India and any disputes shall be subject to the jurisdiction of courts in Noida, Uttar Pradesh.',
        fontSize: 8,
        alignment: 'center',
        margin: [0, 30, 0, 0],
        italics: true
      }
    ],

    styles: {
      title: {
        fontSize: 18,
        bold: true,
        alignment: 'center',
        color: '#2d3e50'
      },
      sectionHeader: {
        fontSize: 12,
        bold: true,
        color: '#2d3e50',
        alignment: 'left',
      },
      signatureHeader: {
        fontSize: 12,
        bold: true,
        alignment: 'center',
        margin: [0, 0, 0, 10]
      }
    },
    defaultStyle: {
      fontSize: 10,
      font: 'Helvetica'
    },
    pageMargins: [40, 40, 40, 40],
  };

  return template;
};

export default getContractTemplate;
