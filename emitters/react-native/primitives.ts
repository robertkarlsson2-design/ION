export type ParsedAttrs = Record<string, string>;

export const RN_STRIPPED_TAGS: ReadonlySet<string> = new Set([
  'br', 'hr', 'meta', 'link', 'script', 'style', 'title', 'head', 'select', 'option',
]);

export const RN_PRIMITIVES: Record<string, string> = {
  // View
  div: 'View', header: 'View', footer: 'View', main: 'View', nav: 'View',
  section: 'View', article: 'View', aside: 'View',
  ul: 'View', ol: 'View', li: 'View',
  table: 'View', thead: 'View', tbody: 'View', tr: 'View', td: 'View',
  form: 'View', figure: 'View', blockquote: 'View', details: 'View',
  body: 'View', html: 'View',
  // Text
  span: 'Text', p: 'Text',
  h1: 'Text', h2: 'Text', h3: 'Text', h4: 'Text', h5: 'Text', h6: 'Text',
  label: 'Text', th: 'Text', figcaption: 'Text',
  pre: 'Text', code: 'Text',
  em: 'Text', strong: 'Text', small: 'Text', mark: 'Text', sup: 'Text', sub: 'Text',
  summary: 'Text',
  // Pressable
  button: 'Pressable', a: 'Pressable',
  // TextInput
  input: 'TextInput', textarea: 'TextInput',
  // Image
  img: 'Image',
  // Modal
  dialog: 'Modal',
  // Stripped (no output)
  br: '', hr: '', meta: '', link: '', script: '', style: '', title: '', head: '',
  select: '', option: '',
};

export const RN_ATTR_MAP: Record<string, string> = {
  onclick:     'onPress',
  onlongpress: 'onLongPress',
  onchange:    'onChange',
  onblur:      'onBlur',
  onfocus:     'onFocus',
  onsubmit:    'onSubmit',
  oninput:     'onInput',
  maxlength:   'maxLength',
  class:       '',
  href:        '',
  for:         '',
  tabindex:    '',
  type:        '',
  readonly:    '',
};

export const RN_TEXT_PRIMITIVES: ReadonlySet<string> = new Set(['Text']);

export const RN_CONTAINER_PRIMITIVES: ReadonlySet<string> = new Set([
  'View', 'ScrollView', 'SafeAreaView', 'KeyboardAvoidingView', 'Modal', 'Pressable',
]);

export const RN_NATIVE_IMPORTS: ReadonlySet<string> = new Set([
  'View', 'Text', 'Pressable', 'TouchableOpacity', 'TextInput', 'Image',
  'ScrollView', 'FlatList', 'SectionList', 'SafeAreaView', 'KeyboardAvoidingView',
  'Modal', 'ActivityIndicator', 'RefreshControl', 'StatusBar', 'Switch',
  'Platform', 'StyleSheet',
]);

export function coerceInputProps(rawAttrs: ParsedAttrs, parentTag: string): ParsedAttrs {
  if (parentTag !== 'input') return rawAttrs;
  const result: ParsedAttrs = { ...rawAttrs };
  if (result['type'] !== undefined) {
    const typeVal = result['type'];
    delete result['type'];
    switch (typeVal) {
      case 'email':    result['keyboardType'] = 'email-address'; break;
      case 'password': result['secureTextEntry'] = '{true}'; break;
      case 'number':   result['keyboardType'] = 'numeric'; break;
      case 'tel':      result['keyboardType'] = 'phone-pad'; break;
    }
  }
  if (result['readonly'] !== undefined) {
    delete result['readonly'];
    result['editable'] = '{false}';
  }
  return result;
}

export function lookupPrimitive(
  htmlTag: string,
): { component: string | null; isContainer: boolean; isText: boolean } {
  if (RN_STRIPPED_TAGS.has(htmlTag)) return { component: null, isContainer: false, isText: false };
  const c = RN_PRIMITIVES[htmlTag];
  if (!c) return { component: null, isContainer: false, isText: false };
  return {
    component: c,
    isContainer: RN_CONTAINER_PRIMITIVES.has(c),
    isText: RN_TEXT_PRIMITIVES.has(c),
  };
}
