
function normalize(phone) {
    let normalizedPhone = phone.toString().replace(/\D/g, '');
    normalizedPhone = normalizedPhone.replace(/^0+/, '');
    if (normalizedPhone.length > 10) {
        normalizedPhone = normalizedPhone.slice(-10);
    }
    return normalizedPhone;
}

const testCases = [
    { input: "+91-7809690538", expected: "7809690538" },
    { input: "07809690538", expected: "7809690538" },
    { input: "7809690538", expected: "7809690538" },
    { input: "917809690538", expected: "7809690538" },
    { input: "  +91 78096 90538  ", expected: "7809690538" },
    { input: "123", expected: "123" }, // Should be 3, but length check in code handles this
];

testCases.forEach(tc => {
    const result = normalize(tc.input);
    if (result === tc.expected) {
        console.log(`✅ PASS: "${tc.input}" -> "${result}"`);
    } else {
        console.log(`❌ FAIL: "${tc.input}" -> "${result}" (expected "${tc.expected}")`);
    }
});
