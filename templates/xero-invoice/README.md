# Xero custom invoice template (Aura style)

`Aura Invoice Template.docx` is uploaded to Xero as a **Custom .docx** branding theme.
Merge field names come from Xero's own sample (UKInvoice.docx).

Rebuild (e.g. after the rebrand – swap the logo file):

    LOGO=path/to/logo.png LOGO_RATIO=<height/width> node build.js        # raw.docx with placeholders
    python3 fields.py raw.docx "Aura Invoice Template.docx"               # real Word MERGEFIELDs
    LOGO=... LOGO_RATIO=... node build.js preview                         # preview.docx with sample values

Address deliberately omits "129" (company preference). No UTR on the invoice.
