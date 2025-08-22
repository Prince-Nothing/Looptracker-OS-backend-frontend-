# looptracker_backend/utils.py
import os

# Define the directory where your protocol markdown files are located
PROTOCOL_DIR = os.path.join(os.path.dirname(__file__), "protocols")

def load_protocol(filename: str) -> str:
    """Loads the content of a single markdown protocol file."""
    filepath = os.path.join(PROTOCOL_DIR, filename)
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return f.read()
        # If you specifically saved some files as .md.txt, change their extension here:
        # For example: if filename == "simulation_refinement.md.txt":
        #   filepath = os.path.join(PROTOCOL_DIR, filename)
        #   with open(filepath, 'r', encoding='utf-8') as f:
        #     return f.read()
    except FileNotFoundError:
        print(f"Warning: Protocol file '{filename}' not found. Check path and filename.")
        return ""

def get_system_context_prompt() -> str:
    """
    Assembles the core system prompt for the AI by loading essential protocols.
    This prompt acts as the AI's fundamental operating instructions.
    """
    # --- START OF MODIFICATION AREA ---
    # 1. Call load_protocol for EACH of your .md files in the protocols folder.
    #    Use the EXACT filename (case-sensitive!) as it appears in your folder.

    ai_core_protocols_content = load_protocol("AI_core_protocols.md")
    internal_learning_content = load_protocol("internal_learning.md")
    kb_master_table_content = load_protocol("KB_master_table.md")
    loop_definition_framework_content = load_protocol("loop_definiton_framework.md")
    seit_f_content = load_protocol("SEIT_F.md")
    supportive_protocols_content = load_protocol("supportive_protocols.md")
    user_guide_theory_content = load_protocol("user_guide_theory.md")
    user_guide_toolkit_content = load_protocol("user_guide_toolkit.md")

    # 2. Combine all the loaded content into the 'combined_context' string.
    #    Add clear markdown headings for each section to help the AI organize its knowledge.
    combined_context = f"""
    # Looptracker OS Core Directives (Always Active):
    These are the foundational principles and protocols that define my identity and operation. I will adhere to them strictly.

    ---
    ## AI Core Protocols (AI_core_protocols.md)
    {ai_core_protocols_content}

    ---
    ## Internal Learning (internal_learning.md)
    {internal_learning_content}

    ---
    ## KB Master Table (KB_master_table.md)
    {kb_master_table_content}

    ---
    ## Loop Definition Framework (loop_definiton_framework.md)
    {loop_definition_framework_content}

    ---
    ## SEIT_F Protocol (SEIT_F.md)
    {seit_f_content}

    ---
    ## Supportive Protocols (supportive_protocols.md)
    {supportive_protocols_content}

    ---
    ## User Guide - Theory (user_guide_theory.md)
    {user_guide_theory_content}

    ---
    ## User Guide - Toolkit (user_guide_toolkit.md)
    {user_guide_toolkit_content}

    ---
    # End of Core Directives. All subsequent interactions must be in alignment with these protocols.
    """
    # --- END OF MODIFICATION AREA ---
    return combined_context.strip() # Remove any extra whitespace from start/end