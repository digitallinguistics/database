# Cosmos DB Client for Digital Linguistics (DLx)

## Database Model

The DLx database has two containers:

- `data`
- `metadata`

## Data

The `data` container contains Lexemes and Texts. This container is partitioned by language (partition key `/language/id`). As such, all items in the `data` container must have a `language` property whose value is an object with, minimally, an `id` property. Each item in the container must also have a `"type"` of either `"Lexeme"` or `"Text"`. As an example:

```json
{
  "type": "Lexeme",
  "language": {
    "id": "f8a669d3-131b-44f3-88ab-edaa33604202",
    "name": {
      "eng": "Chitimacha"
    }
  }
}
```

## Metadata

The `metadata` container contains all other types of database objects. Each item in this container must have a `"type"` property, which is also its partition key (`/type`).

### Types of Metadata

- `BibliographicSource`
- `Language`
- `Location`
- `Media`
- `Person`
- `User`

## Permissions

There are 4 types of permissions:

- `public`: Any user may view the resource.
- `viewer`: The user may view the resource, even when not public.
- `editor`: The user may edit but not delete the resource.
- `admin`: The user may edit and delete the resource, or set permissions for it.

Objects which have permissions:

- Bundle
- Language
- Note (`public` only)
- Project
- Status (`public` only)

Permissions on one resource do *not* imply certain permissions on another permissioned resource. There is no hierarchy of permissions between Projects and Languages. If a Project is publicly viewable, its languages may not be, and vice versa.

Permissions for other items *are* determined by their parent item, because they are only ever viewable in the context of that parent item. This *may* result in, for example, a single Lexeme being viewable using one filter but not another. The user may have permission to view a Project's info but not a Language's info, so the user could view that Lexeme in the context of the Project but not in the context of the Language.

Items which get their permissions from their parent items:

- Lexeme
- Person
- Text

It is up to software implementations to impose any type of consistency of permissions between Languages and Projects.

## Releases

Releases are currently manual:

1. `npm version`
2. `npm publish`
