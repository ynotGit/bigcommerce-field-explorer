# bc-field-explorer

See every custom field and metafield in a BigCommerce catalog, and the products,
variants, categories and brands that have each one: the data the admin cannot
search. Open it in your browser, choose a field, and download what has it as
CSV or PDF.

The tool is simply a viewer/explorer, it cannot add data. 

To manage metafields use:
https://www.hypaapps.com/bigcommerce-apps/metafields-manager/

Custom fields are managed natively in admin.

## Install

Needs Node 20 or newer. From your project root:

```
npm install -D github:ynotGit/bigcommerce-field-explorer
```

This adds the tool to your project's dev dependencies, so its commands run
through `npx`. To update to the latest version, run the same command again.

## API account

Each store needs a store-level API account: in the BigCommerce admin, go to
Settings > Store-level API accounts and create one with the token type
"V2/V3 API token". It needs one scope; leave the rest on None.

| Scope    | Level     |
| -------- | --------- |
| Products | read-only |

That one scope covers products, variants, categories and brands. The tool only
ever reads. Keep the store hash (or the API path) and the access token it shows
you; the client ID and secret are not used.

## First time

From your project root:

```
npx field-explorer setup staging production
npx field-explorer env use staging
```

`setup` asks for each store's hash and API token, then checks it can read the
catalog. The token stays hidden as you type or paste it. Credentials are saved
in a new `field-explorer/` folder and gitignored. `env use` chooses which store
the page reads.

## Using it

```
npx field-explorer start
```

This opens <http://localhost:4322> in your browser, reads the catalog, and lists
every field in it, in five sections:

| Section | What has the field |
| --- | --- |
| Product metafields | Products |
| Product custom fields | Products |
| Variant metafields | Variants |
| Category metafields | Categories |
| Brand metafields | Brands |

For each field: how many have it, how many different values it has, and its
most common values.

```
Namespace  Key       Products  Values  Most common values
erp        season         120       3  AW26 84   SS26 30   SS25 6
erp        supplier        97      12  Acme 40   Highland Mills 22   …
```

**Know the field you want?** Type in the filter box at the top (or press `/` to
jump to it). The list narrows as you type to fields whose key, name or namespace
match: `season`, `erp season` and `erp.season` all find `season` in `erp`. Press
Enter to open the first match. The filter stays put when you go back to the
list.

**Choose a field** to see everything that has it. Say you choose the `season`
metafield. A row of buttons along the top switches what is listed, each with a
count:

- *With season*: every product that has a `season` metafield, whatever its
  value. This is what opens first.
- *AW26*, *SS25* and the field's other common values: just the products with
  that value.
- *Without season*: every product that has no `season` metafield at all. Handy
  for checking that a change copes with the field being missing.

Each count is exactly the number of products you get.

**Choose a value** in the list to go straight to what has that value.

What is listed depends on the field:

| Field on | Listed with |
| --- | --- |
| Products | ID, name, SKU, the field's value, visibility |
| Variants | Variant ID, product, SKU, options (Size: M), the field's value, and flags for a hidden product or a variant that cannot be bought |
| Categories | ID, name, URL, category tree (on stores with more than one), the field's value, visibility |
| Brands | ID, name, URL, the field's value |

Sort by any column, and download the list as **CSV** (every row, ready for
Excel) or **PDF** (a printable table headed with the store, the date and what
it shows). **Download CSV** on the field list saves the list of fields itself.

Each field's page has its own address, so you can bookmark it, or come back to
it with the browser's Back button.

Keys and values that differ only in case (`season` and `Season`) are counted as
one, and the page tells you when a field is spelt more than one way: worth
knowing, and worth telling the client.

Reading the catalog takes a few seconds for a few thousand products. Variants
are read the first time you open a variant field, since there can be many more
of them. After that everything is instant, because the page keeps what it read.
**Read the catalog again** picks up changes made since. Press Ctrl+C in the
terminal to stop it.

## When a ticket is vague

"We have products with metafields that we'd like to do X with":

1. Open the page and find the field. If you are not sure which one it means,
   **Download CSV** on the list and ask the client.
2. Choose the field. The buttons along the top give you things to test against:
   a typical value, an odd one, and, under *Without*, ones that do not have the
   field at all.
3. Download the CSV before the change, and again after, to compare.

## Switching store

```
npx field-explorer env use production
```

The page shows which store it is reading. To read another store just once, add
`--env`: `npx field-explorer start --env production`.

## Good to know

- Metafields that an app has marked private (`app_only`) can only be read by
  that app, so they do not show up here. Metafields an app shares (permission
  `read` or `write`) do.
- Metafields on channels, orders, customers and the store itself are not
  listed.
- Hidden products and categories are included, and marked as hidden.
- The page only answers on this computer, at localhost.
- A teammate joining the project runs `npm install`, then the same `setup`
  command to add their own credentials.

Everything else (every option, how the catalog is read, a VS Code task) is in
[docs/REFERENCE.md](docs/REFERENCE.md).
