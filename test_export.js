const XLSX = {
    utils: {
        json_to_sheet: () => { },
        book_new: () => { },
        book_append_sheet: () => { }
    },
    write: () => { }
};

function formatTime(date) {
    return date.toTimeString().split(' ')[0];
}
function getDateString(date) {
    return date.toISOString().split('T')[0];
}
function formatHMS(sec) {
    return sec + 's';
}

const mockItem = {
    name: "Main Activity",
    startAt: new Date("2024-01-01T10:00:00"),
    endAt: new Date("2024-01-01T11:00:00"),
    duration: 3600000,
    deleted: false,
    residents: [
        {
            name: "Alice",
            addedAt: new Date("2024-01-01T10:00:00"),
            status: "active",
            records: [
                { type: "leaved", time: new Date("2024-01-01T10:15:00"), deleted: false },
                { type: "backed", time: new Date("2024-01-01T10:45:00"), deleted: false }
            ]
        },
        {
            name: "Bob",
            addedAt: new Date("2024-01-01T10:00:00"),
            status: "leaved",
            records: [
                { type: "leaved", time: new Date("2024-01-01T10:30:00"), deleted: false }
            ]
        },
        {
            name: "Charlie (Extra)",
            addedAt: new Date("2024-01-01T10:00:00"),
            status: "active",
            records: [
                {
                    type: "extra",
                    name: "Piano",
                    startAt: new Date("2024-01-01T10:20:00"),
                    endAt: new Date("2024-01-01T10:40:00"),
                    deleted: false
                }
            ]
        },
        {
            name: "David (Extra + Leave)",
            addedAt: new Date("2024-01-01T10:00:00"),
            status: "leaved",
            records: [
                {
                    type: "extra",
                    name: "Guitar",
                    startAt: new Date("2024-01-01T10:10:00"),
                    endAt: new Date("2024-01-01T10:30:00"),
                    deleted: false
                },
                { type: "leaved", time: new Date("2024-01-01T10:30:00"), deleted: false }
            ]
        }
    ]
};

const rows = [];
const item = mockItem;
const itemResidents = item.residents || [];

itemResidents.forEach((r) => {
    const residentName = r.name;
    const records = r.records || [];
    const addedAt = r.addedAt;
    const residentStatus = r.status || 'active';

    console.log(`Processing ${residentName}, Status: ${residentStatus}`);

    if (records.length === 0) {
        if (residentStatus === 'active') {
            const duration = item.endAt.getTime() - addedAt.getTime();
            rows.push({
                Name: residentName,
                Start: formatTime(addedAt),
                End: formatTime(item.endAt),
                Type: 'Full Duration'
            });
        }
    } else {
        let currentStartTime = addedAt;
        const activeRecords = records.filter((rec) => !rec.deleted);

        activeRecords.forEach((record) => {
            console.log(`  Record: ${record.type} at ${formatTime(record.time || record.startAt)}`);

            if (record.type === 'extra') {
                const extraStartAt = new Date(record.startAt);
                const extraEndAt = new Date(record.endAt);

                // Main before extra
                if (currentStartTime.getTime() < extraStartAt.getTime()) {
                    rows.push({
                        Name: residentName,
                        Start: formatTime(currentStartTime),
                        End: formatTime(extraStartAt),
                        Type: 'Main (Before Extra)'
                    });
                }
                // Extra
                rows.push({
                    Name: residentName,
                    Start: formatTime(extraStartAt),
                    End: formatTime(extraEndAt),
                    Type: `Main with ${record.name}`
                });
                currentStartTime = extraEndAt;

            } else if (record.type === 'leaved') {
                const recordTime = new Date(record.time);
                // Create a record from currentStartTime to this leave time
                const duration = recordTime.getTime() - currentStartTime.getTime();
                console.log(`    -> Push Row: ${formatTime(currentStartTime)} to ${formatTime(recordTime)} (Active)`);
                rows.push({
                    Name: residentName,
                    Start: formatTime(currentStartTime),
                    End: formatTime(recordTime),
                    Type: 'Active Segment (until Leave)'
                });
                // Update currentStartTime to this leave time to prevent gap filling
                currentStartTime = recordTime;
            } else if (record.type === 'backed') {
                console.log(`    -> Backed: Reset startTime to ${formatTime(record.time)}`);
                currentStartTime = new Date(record.time);
            }
        });

        if (residentStatus === 'active') {
            // Only add final segment if time remains and start < end
            if (currentStartTime.getTime() < item.endAt.getTime()) {
                const duration = item.endAt.getTime() - currentStartTime.getTime();
                console.log(`  Final Active Segment: ${formatTime(currentStartTime)} to ${formatTime(item.endAt)}`);
                rows.push({
                    Name: residentName,
                    Start: formatTime(currentStartTime),
                    End: formatTime(item.endAt),
                    Type: 'Final Active Segment'
                });
            }
        }
    }
});

console.log("\nGenerated Rows:");
console.table(rows);
