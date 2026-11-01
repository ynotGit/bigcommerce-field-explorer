# Reference

The [README](../README.md) covers the everyday flow. This page has the detail.

- [Commands](#commands)
- [The page](#the-page)
- [Downloads](#downloads)
- [Environments](#environments)
- [How the catalog is read](#how-the-catalog-is-read)
- [VS Code task](#vs-code-task)
- [Safety](#safety)
- [Working on the tool](#working-on-the-tool)

## Commands

| Command | What it does |
| --- | --- |
| `start` | Starts the page and opens it in your browser. `--port` changes the port (4322 by default, so it can run beside the email builder's preview on 4321); `--no-open` starts it without opening a browser. A browser is only opened from a terminal, never from a script. Runs until Ctrl+C. |
| `setup [environment...]` | Saves credentials for each environment named (`default` if none) and checks each can read the catalog. Does not select an environment. Safe to rerun: environments already saved are skipped. Credentials that fail the check are not kept. |
| `env` | Lists saved environments; `*` marks the selected one. |
| `env use <name>` | Points the page at that environment until you switch again. |
| `env add <name>` | Saves one more store's credentials. `--force` replaces existing ones. |

Add `--env <name>` to any command to use that environment for that command only.

`--help` lists every option. `--version` prints the version and, for an install
from GitHub, the commit it came from, such as `0.1.0 (5392e1c)`.

For scripts, `setup` and `env add` accept `--store-hash <hash> --token <token>`
instead of asking. The store hash can be the full API path BigCommerce shows.

Commands work from the project root or from inside `field-explorer/`. Run from
a folder further down the project, a command says where the project root is and
does nothing else. A command given an option it does not take stops before
doing anything.

## The page

`start` serves one page at `http://localhost:4322`, for the environment
selected when it started (or the one named with `--env`). It works with no
internet connection beyond the store's API: nothing is loaded from elsewhere.

**The field list** is what the page opens on. It lists every field in the
catalog, in five sections: product metafields, product custom fields, variant
metafields, category metafields and brand metafields. For each: the namespace
and key (for custom fields, the name), how many products, variants, categories
or brands have it, how many different values it has, and its most common values
with how many have each. The most widely used fields come first in each
section. The line at the top says how many products, variants, categories and
brands have any fields at all, and a note at the foot explains why metafields an
app keeps to itself are missing.

- Names, keys, namespaces and values are compared ignoring case and spaces at
  either end. A field spelt more than one way (`season` on some products,
  `Season` on others) is one row, shown in its most common spelling, with the
  others listed under it. A value is shown in its most common spelling too.
- A value that is set but empty is a value like any other, shown as *empty*.
- Values longer than 200 characters are cut short in the list, and still find
  what has them when chosen.
- A metafield on a category or brand that no longer exists is not counted.

**Filtering the list.** The box at the top narrows the list as you type. A field
stays if every word typed appears in its key, name, namespace or another
spelling of its name, ignoring case; spaces, dots, slashes and colons separate
words, so `erp season`, `erp.season` and `erp/season` all find `season` in
`erp`. What matched is highlighted, sections with no matches are left out, and
a line under the box says how many fields match. Enter opens the first match
(the first in the list, sections in order), Escape clears the box, and `/`
jumps to it from anywhere on the list. The filter does not look at values. It
is kept while a field's page is open, so Back returns to the same short list.

**A field's page** opens when you choose a field, or one of its values. A row of
buttons along the top chooses what it lists, each named after the field (here,
a field called `season`) and showing how many it lists:

| Button | Lists |
| --- | --- |
| *With season* | Everything that has the field, whatever its value. Chosen when the page opens from the field's name. |
| A value, such as *AW26* | Everything with that value. There is a button for each of the eight most common values; *empty* is one, when the field is set to nothing. |
| *Without season* | Everything that does not have the field at all. |

So for a product metafield with 120 products, 84 of them `AW26`, in a catalog of
500 products, the buttons read *With season 120*, *AW26 84* and so on, and
*Without season 380*. Each count is exactly the number listed.

What is listed, and the columns it is listed in, depend on what the field is on:

| Field on | Columns |
| --- | --- |
| Products | ID, Name, SKU, Price, Sale price, the field, Visibility |
| Variants | Variant ID, Product, SKU, Options, Price, Sale price, the field, Status |
| Categories | ID, Name, URL, Tree, the field, Visibility |
| Brands | ID, Name, URL, the field |

- *Sale price* is only shown when something listed is on sale.
- *The field* (headed with its name, as `season (erp)`) is left out for things
  without it. Several values on one thing are listed one under another.
- *Options* is a variant's option values, as `Size: M, Colour: Navy`. A
  product's base variant has none.
- A variant without a price or sale price of its own shows its product's, as
  the storefront does. *Status* flags a variant whose product is hidden, and a
  variant whose purchasing is disabled.
- *Tree* is the category tree a category is in. It is only shown when the store
  has more than one, as Multi-Storefront stores can.
- *URL* is the storefront path, such as `/shirts/linen/`.

Everything is sorted by name (variants by their product's name); click a column
heading to sort by it, again to reverse. The page shows the first 1,000; the
downloads always have everything.

**Addresses.** The address says what is open, so the browser's Back button and
bookmarks work:

| Address | Shows |
| --- | --- |
| `#` (nothing) | The field list |
| `#field/mf/<namespace>/<key>` | A product metafield's page, *With* chosen |
| `#field/cf//<name>` | A product custom field's page |
| `#field/variant/<namespace>/<key>` | A variant metafield's page |
| `#field/category/<namespace>/<key>` | A category metafield's page |
| `#field/brand/<namespace>/<key>` | A brand metafield's page |
| `…?value=<value>` | What has one value (`?value=` for empty) |
| `…?missing=1` | What does not have the field |

Choosing a chip replaces the address rather than adding to it, so Back returns
to the list.

**The catalog in memory.** When the page opens it reads every product with its
custom fields, every category and brand, and every metafield on products,
variants, categories and brands. Variants themselves are counted then, but only
read the first time a variant field is opened, since a catalog can have many
times more variants than products. Everything after that uses what was read. It
is kept for 15 minutes, or until **Read the catalog again**, and the header says
when it was read. Stopping the page forgets it.

## Downloads

| Download | What it holds |
| --- | --- |
| **Download CSV** on the field list | Every field: `type` (metafield or custom field), `on` (products, variants, categories or brands), `namespace`, `name`, `count`, `values`, `most_common_values` |
| **Download CSV** on a field's page | Everything it shows, with the columns below, then the field's values (left out for things without it). Several values in one cell are joined with ` \| `. |
| **Download PDF** on a field's page | An A4 landscape table with the same columns as the page, headed with what it shows, the store, when the catalog was read and how many there are. Long tables carry on over as many pages as they need, with the column headings repeated. |

| Field on | CSV columns |
| --- | --- |
| Products | `id`, `name`, `sku`, `price`, `sale_price`, `url`, `visible` |
| Variants | `variant_id`, `product_id`, `product_name`, `sku`, `options`, `price`, `sale_price`, `purchasing_disabled`, `product_visible` |
| Categories | `id`, `name`, `url`, `tree`, `visible` |
| Brands | `id`, `name`, `url` |

CSVs always have the sale price column, so spreadsheets made at different times
line up. They have a byte order mark, so Excel reads accented characters and £
signs correctly. Prices are written with at least two decimal places and
without thousands separators, so spreadsheets read them as numbers. Downloads
are named after what they show and the date, such as
`erp-season-aw26-2026-10-31.csv` or `variants-erp-barcode-2026-10-31.pdf`.

The PDF uses the standard PDF fonts, which cover Western European languages;
other characters (Chinese or Greek, say) are shown as `?` there. The page and
the CSV show everything.

## Environments

An environment is one store: a store hash and an access token. Each is saved in
`field-explorer/` as `.env.<name>` (`.env` for `default`), with permissions that
let only you read it. `.active-env` remembers which one the page uses. All
three are gitignored; `setup` adds them to `field-explorer/.gitignore`.

The tool never guesses between stores. With more than one environment saved,
one has to be chosen with `env use` (or `--env`, or the `FIELD_EXPLORER_ENV`
variable) before the page starts. A project whose only environment is `default`
needs no choosing.

In CI, or anywhere without saved credentials, the `default` environment reads
`BC_STORE_HASH` and `BC_ACCESS_TOKEN` from the environment or from a `.env` in
the project root. When a saved file exists, its credentials are the only ones
used, so a stray shell variable cannot point the page at another store.

| Variable | What it does |
| --- | --- |
| `FIELD_EXPLORER_ENV` | The environment to use, as `--env` does |
| `BC_API_TIMEOUT_MS` | How long one request may take (60000 by default), for a slow connection |
| `BC_API_URL` | The API's address, for testing against a mock |
| `NO_COLOR` | Turns colour off |

## How the catalog is read

| What | From |
| --- | --- |
| Products, with custom fields | `GET /v3/catalog/products?include=custom_fields`, without descriptions |
| Categories | `GET /v3/catalog/trees/categories`, and `GET /v3/catalog/trees` for the trees' names. A store without category trees is read through `GET /v3/catalog/categories`. |
| Brands | `GET /v3/catalog/brands` |
| How many variants there are | `GET /v3/catalog/variants?limit=1` |
| Variants, when a variant field is first opened | `GET /v3/catalog/variants` |
| Metafields | `GET /v3/catalog/products/metafields`, `/variants/metafields`, `/categories/metafields` and `/brands/metafields` |

Everything is read 250 to a page, four pages at a time. When BigCommerce reports
its rate limit is reached, the tool waits for the time it gives and tries again.

Nothing is written to disk. What the tool cannot see:

- Metafields with the permission `app_only`. Only the app that wrote them can
  read them. Metafields with the permission `read`, `write`,
  `read_and_sf_access` or `write_and_sf_access` are open to other API accounts,
  this one included.
- Metafields on channels, orders, customers, carts, locations or the store.
- Price lists and customer group pricing: the price shown is the product's or
  variant's own.

## VS Code task

Teammates can open the page from the Command Palette (Tasks: Run Task). Add
this as `.vscode/tasks.json` in the project:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Open field explorer",
      "type": "shell",
      "command": "npx field-explorer start",
      "isBackground": true,
      "problemMatcher": []
    }
  ]
}
```

## Safety

- The tool only sends GET requests to the store. It cannot change anything.
- The access token is never shown on screen when a command asks for it; it
  reports how many characters it received instead. A token passed with
  `--token` stays in your shell's history, so keep that for scripts.
- The tool never requests orders or customers.
- The page listens only on this computer (127.0.0.1) and only answers requests
  addressed to localhost. Requests that read the catalog are only accepted from
  the page itself, so another website open in the browser cannot use it.

## Working on the tool

    npm install         # also compiles the TypeScript
    npm link            # puts `field-explorer` on your PATH
    npm run typecheck
    npm test            # build, then run the commands and the page against a mock API

Source is TypeScript in `src/`; the page is `assets/ui.html`.

| File | What it holds |
| --- | --- |
| `cli.ts` | The commands and their options |
| `server.ts` | The page's server and its API |
| `assets/ui.html` | The page itself: one file, no outside resources |
| `cache.ts` | The catalog the page keeps in memory |
| `summary.ts` | The field list |
| `items.ts` | What a field's page lists, and its columns on the page, in the CSV and in the PDF |
| `catalog.ts` | Fetching products, variants, categories, brands and their metafields |
| `api.ts` | Requests to the BigCommerce API: paging, rate limits, errors |
| `pdf.ts` | The PDF |
| `setup.ts` | Saving credentials; the `setup` and `env` commands |
| `config.ts` | Environments, and where the workspace is |
| `color.ts`, `version.ts` | Terminal colours; which build this is |
| `types.ts` | The shapes of the API's data |

The test runs every command, and every request the page makes, against a mock
of the BigCommerce API, including paging, a rate-limited request, a store with
two category trees, a store without them, and the page's protections. It checks
that every count on the field list is exactly the number of products, variants,
categories or brands it leads to. It has not yet been run against a live store.
