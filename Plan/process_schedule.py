import csv
import re
from collections import defaultdict

csv_path = r"c:\VI\Mini-Project\Sway\Morning List.csv"
html_path = r"c:\VI\Mini-Project\Sway\Schedule&Venue.html"

# Labs mapping
event_venues = {
    'CodeX': 'Lab 1',
    'Code in the Dark': 'Lab 2',
    'Pixel Forge': 'Lab 4',
    'Codeverse': 'Lab 3',
    'Prompt Wars': 'Lab 3',
    'CodeinDark': 'Lab 2',      # from current html
    'PixelFordge': 'Lab 4',     # from current html
}

# Read CSV and collect user events
# Column indices based on provided snippet:
# 2: Full Name
# 5: Enrollment Number
# 9: Event
participants = []

with open(csv_path, 'r', encoding='utf-8') as f:
    reader = csv.reader(f)
    header = next(reader)
    for row in reader:
        if len(row) > 9:
            name = row[2].strip()
            enroll = row[5].strip()
            event = row[9].strip()
            if name and enroll and event:
                participants.append({
                    'name': name,
                    'enroll': enroll,
                    'event': event
                })

# Assign Time slots avoiding conflicts for the same user
user_slots = defaultdict(list)
final_rows = []

time_slots = ['11:00 AM - 12:00 PM', '12:00 PM - 01:00 PM']

# To maintain consistency, sort participants by name
participants.sort(key=lambda x: x['name'].lower())

for p in participants:
    name = p['name']
    event = p['event']
    event_canonical = 'Codeverse' if event in ('Prompt Wars', 'Codeverse') else ('CodeinDark' if event == 'Code in the Dark' else ('PixelFordge' if event == 'Pixel Forge' else event))
    venue = event_venues.get(event, 'Lab 1')
    
    # Check if they already have a time slot
    assigned_slot = None
    for slot in time_slots:
        if slot not in user_slots[p['enroll']]:
            assigned_slot = slot
            break
            
    if not assigned_slot:
        assigned_slot = time_slots[0] # Fallback if more than 2 events
        
    user_slots[p['enroll']].append(assigned_slot)
    
    html_row = f"<tr><td>{p['name']}</td><td>{p['enroll']}</td><td>{event_canonical}</td><td>{venue}</td><td>{assigned_slot}</td></tr>"
    final_rows.append(html_row)

rows_html = "\n".join(final_rows)

# Read the HTML template
with open(html_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the tbody
tbody_pattern = re.compile(r'<tbody>.*?</tbody>', re.DOTALL)
new_tbody = f"<tbody>\n{rows_html}\n        </tbody>"
content_modified_tbody = tbody_pattern.sub(new_tbody, content)

# Enhance the search script
# Make it more robust by splitting search terms
advanced_script = r"""<script>
function filterTable() {
    const input = document.getElementById("search");
    const filterText = input.value.toLowerCase().trim();
    const searchTerms = filterText.split(/\s+/);
    const table = document.getElementById("scheduleTable");
    const tr = table.getElementsByTagName("tr");

    for (let i = 1; i < tr.length; i++) {
        const tds = tr[i].getElementsByTagName("td");
        let rowContent = "";
        for (let j = 0; j < tds.length; j++) {
            rowContent += tds[j].textContent.toLowerCase() + " ";
        }
        
        let allTermsFound = true;
        for (const term of searchTerms) {
            if (rowContent.indexOf(term) === -1) {
                allTermsFound = false;
                break;
            }
        }
        
        tr[i].style.display = allTermsFound ? "" : "none";
    }
}
</script>"""

script_pattern = re.compile(r'<script>.*?</script>', re.DOTALL)
final_content = script_pattern.sub(advanced_script.replace('\\', '\\\\'), content_modified_tbody)

with open(html_path, 'w', encoding='utf-8') as f:
    f.write(final_content)

print("HTML updated successfully!")
