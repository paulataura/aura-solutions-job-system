# Xero custom invoice template (Aura style)

`Aura Invoice Template.docx` is uploaded to Xero as a **Custom .docx** branding theme.
Merge field names come from Xero's own sample (UKInvoice.docx).

Rebuild (e.g. after the rebrand – swap the logo file):

    LOGO=path/to/logo.png LOGO_RATIO=<height/width> node build.js        # raw.docx with placeholders
    python3 fields.py raw.docx "Aura Invoice Template.docx"               # real Word MERGEFIELDs
    python3 transplant.py "Aura Invoice Template.docx" "Aura Invoice Template (Xero package).docx"   # REQUIRED: Xero only accepts it inside its own package
    LOGO=... LOGO_RATIO=... node build.js preview                         # preview.docx with sample values

Upload the "(Xero package)" file. transplant.py needs xero-sample-UKInvoice.docx at src/UKInvoice.docx.

Address deliberately omits "129" (company preference). No UTR on the invoice.
