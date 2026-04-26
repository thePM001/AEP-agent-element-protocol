# /aep-register

## AEP 2.5 Element Registration

Use this command when creating a new UI element that renders pixels.

### Required Information

To register an element, provide:
1. **label**: Human-readable name (e.g. "Settings Modal", "Sort Popover")
2. **category**: One of: navigation, data-display, action, layout, feedback, input
3. **function**: One sentence describing what this element does
4. **component_file**: The source file where this element is defined
5. **parent**: The xid of the parent element (from aep-scene.json)
6. **skin_binding**: The theme key for this element's visual style
7. **states**: Object mapping state names to descriptions
8. **z**: z-index layer (0-100)

### Registration Process

**Step 1: Generate xid**

Format: `xid:v1:{domain}:{category}:{region}:{unique_id}`

- domain: 3-digit code (e.g. 030 for UI)
- category: c000000 (default)
- region: r000000 + sequential number
- unique_id: 16-digit hex, sequential within the project

**Step 2: Add to aep-registry.yaml**

```yaml
{xid}:
  label: "{label}"
  category: {category}
  function: "{function}"
  component_file: "{component_file}"
  parent: "{parent_xid}"
  skin_binding: "{skin_binding}"
  states:
    default: "{default state description}"
    {other_state}: "{description}"
```

**Step 3: Add to aep-scene.json**

```json
{
  "id": "{xid}",
  "type": "component",
  "label": "{label}",
  "z": {z},
  "visible": true,
  "parent": "{parent_xid}",
  "layout": {}
}
```

**Step 4: Add skin_binding to aep-theme.yaml (if new)**

If the skin_binding does not already exist in aep-theme.yaml, add it:

```yaml
component_styles:
  {skin_binding}:
    background: "{from palette}"
    colour: "{from palette}"
    # ... style properties from the theme
```

**Step 5: Add data-aep-id to the component**

In the component source file, add the attribute to the root DOM element:

```jsx
<div data-aep-id="{xid}">
  {/* component content */}
</div>
```

**Step 6: Verify**

Run `/aep-validate` to confirm the registration is complete and consistent across all three files.
