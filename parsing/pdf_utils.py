import re
import fitz  # PyMuPDF


def extract_text_with_page_markers(file_path):
    """Extracts text from a PDF with markers for each page using PyMuPDF (fitz) for better quality."""
    text_content = []
    doc = fitz.open(file_path)

    for i in range(len(doc)):
        page_num = i + 1
        page = doc.load_page(i)
        page_text = page.get_text("text")

        text_content.append(f"==Start of OCR for page {page_num}==")
        text_content.append(page_text)
        text_content.append(f"==End of OCR for page {page_num}==")

    doc.close()
    return "\n".join(text_content)


def extract_text_simple(file_path):
    """Extracts all text from a PDF without page markers using PyMuPDF (fitz)."""
    text_content = []
    doc = fitz.open(file_path)

    for page in doc:
        page_text = page.get_text("text")
        if page_text:
            text_content.append(page_text)

    doc.close()
    return "\n".join(text_content)


def ocr_pdf_via_images(file_path, output_txt_path=None):
    """
    Converts each PDF page to an image and uses the multimodal LLM to extract text.
    Returns the combined text with page markers.
    Retry / rate-limit / quota handling delegated to parsing_llm_client.
    """
    from parsing.llm_client import parsing_llm_client

    ocr_prompt = (
        "This is a page from a university course catalog PDF. "
        "Extract all the text exactly as it appears. "
        "Do not repeat characters (e.g. dots, dashes) — replace dot leaders like '......' with a single space. "
        "Output only the text, no commentary."
    )

    doc = fitz.open(file_path)
    total_pages = len(doc)

    if output_txt_path:
        with open(output_txt_path, 'w', encoding='utf-8') as f:
            f.write("")

    text_blocks = []

    for i in range(total_pages):
        page_num = i + 1
        print(f"OCR-ing Page {page_num}/{total_pages}...", flush=True)

        page = doc.load_page(i)
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        img_bytes = pix.tobytes("png")

        page_text = parsing_llm_client.invoke_multimodal(
            image_bytes=img_bytes,
            prompt=ocr_prompt,
            min_interval=10,
            max_retries=20,
            context="OCR",
        )

        if not page_text:
            page_text = f"[OCR FAILED - PAGE {page_num}]"
            print(f"  Page {page_num}: all retries exhausted.", flush=True)

        page_block = f"==Start of OCR for page {page_num}==\n{page_text}\n==End of OCR for page {page_num}==\n"
        text_blocks.append(page_block)

        if output_txt_path:
            with open(output_txt_path, 'a', encoding='utf-8') as f:
                f.write(page_block)
                f.flush()

    doc.close()
    return "".join(text_blocks)


def extract_pages_from_string(full_text, target_pages):
    """Extracts specific pages from a full text string based on markers."""
    extracted_chunks = []

    for page_num in target_pages:
        pattern = rf"==Start of OCR for page {page_num}==(.*?)==End of OCR for page {page_num}=="
        match = re.search(pattern, full_text, re.DOTALL)

        if match:
            extracted_chunks.append(match.group(0))
        else:
            print(f"Warning: Page {page_num} not found in text.")

    return "\n".join(extracted_chunks)
