import docx

def fill_template(input_path, output_path):
    doc = docx.Document(input_path)
    
    doc.paragraphs[10].text = "----- Sway: An Intelligent LLM Gateway -----"
    doc.paragraphs[9].text = "Sway - An Intelligent LLM Gateway for Compute Efficiency and Hallucination Mitigation"
    doc.paragraphs[11].text = "Sway is an intelligent LLM gateway designed to eliminate AI compute waste. Currently, AI applications suffer from token inefficiency, API spend on repeat queries, and hallucinations in workflows. The proposed solution is a three-layer computational architecture: Semantic Caching for position-independent reuse of repeated intent, Intelligent Routing for complexity-aware model tiering, and Agentic Chunking to enforce deterministic logic pipelines that suppress hallucinations. Sway operates via a local interception proxy, offering high-efficiency API interactions. The expected outcome is a 50% reduction in token costs and significant hallucination prevention."
    doc.paragraphs[13].text = "The rapid adoption of Large Language Models (LLMs) has revealed significant operational inefficiencies. Approximately 30% of enterprise queries are semantically similar but structurally diverse, causing literal-match caching to fail resulting in massive compute waste. Additionally, long-horizon agentic workflows face severe token overhead and are prone to unbounded hallucinations when interpreting unchunked data. A systemic, interception-based governance layer is required to enforce operational efficiency and safety."
    doc.paragraphs[16].text = "• Objective 1: To implement Semantic Caching with Position-Independent reuse to eliminate cost on semantically identical queries."
    doc.paragraphs[17].text = "• Objective 2: To design an Intelligent Routing nexus that dynamically directs tasks to cost-effective models based on computation complexity."
    doc.paragraphs[18].text = "• Objective 3: To develop Agentic Chunking (proposition-based segmentation) to establish deterministic analysis paths and drastically reduce reasoning hallucinations."
    doc.paragraphs[20].text = "The scope includes developing the gateway as a local Node.js proxy, establishing local semantic vectors (via Chroma/SQLite), and integrating with OpenAI and Anthropic APIs. Limitations: The tool relies on Bring-Your-Own-Key (BYOK) and does not override upstream provider-enforced limits."
    doc.paragraphs[22].text = "Current solutions like LiteLLM proxy requests but lack deep semantic validation or fallback strategies for agentic workflows. Traditional fixed-size RAG chunking severs logical statements, worsening LLM hallucinations during retrieval."
    doc.paragraphs[24].text = "Sway introduces a tri-layer gateway: Layer 01 (Semantic Cache) cuts out repetitive compute; Layer 02 (Intelligent Routing) governs token economics dynamically; Layer 03 (Agentic Chunking) enforces meaning-aware contexts to synthesize reliable responses. It uses a semantic judge to ensure high cache accuracy."
    
    doc.paragraphs[31].text = "Programming Language: JavaScript (Node.js), Python (Semantic Judge layer)"
    doc.paragraphs[32].text = "Database: Local Vector Store (ChromaDB / Vector-Enabled SQLite)"
    doc.paragraphs[33].text = "Tools: Express.js, http-proxy-middleware, Chart.js"
    
    doc.paragraphs[35].text = "Hardware: Standard PC (Optional GPU configuration for 1B-parameter Semantic judge)"
    doc.paragraphs[36].text = "Software: Windows / macOS / Linux, Node.js +18"
    
    doc.paragraphs[38].text = "A 6x increase in throughput per dollar compared to unoptimized systems, up to 50% reduction in API token costs, and a deterministic suppression of workflow hallucinations, thereby providing a secure and scalable execution firewall for developers."
    
    doc.paragraphs[42].text = "1. EPIC Framework analysis on Position-Independent Caching.\n2. Weaviate & Deepchecks Documentation on Agentic Chunking vs Fixed Chunking.\n3. OpenAI Platform API & Anthropic Optimization Guidelines."
    
    # Fill Table
    table = doc.tables[0]
    table.rows[1].cells[2].text = "Jan - Feb"
    table.rows[2].cells[2].text = "Mid March"
    table.rows[3].cells[2].text = "April"
    table.rows[4].cells[2].text = "May"
    
    doc.save(output_path)

if __name__ == "__main__":
    fill_template(r"c:\VI\Mini-Project\Sway\Mini_Project_Synopsis_Template.docx", r"c:\VI\Mini-Project\Sway\Sway_Mini_Project_Synopsis.docx")
