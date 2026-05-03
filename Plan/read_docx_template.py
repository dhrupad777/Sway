import docx

def read_template(file_path):
    doc = docx.Document(file_path)
    with open('template_dump.txt', 'w', encoding='utf-8') as f:
        f.write("--- PARAGRAPHS ---\n")
        for i, p in enumerate(doc.paragraphs):
            f.write(f"[{i}]: {p.text}\n")
            
        f.write("\n--- TABLES ---\n")
        for t_idx, table in enumerate(doc.tables):
            f.write(f"Table {t_idx}:\n")
            for r_idx, row in enumerate(table.rows):
                row_data = [cell.text.replace('\n', ' ') for cell in row.cells]
                f.write(f"  Row {r_idx}: {row_data}\n")

if __name__ == "__main__":
    read_template(r"c:\VI\Mini-Project\Sway\Mini_Project_Synopsis_Template.docx")
