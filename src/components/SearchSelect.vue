<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check, ChevronDown, Search, X } from 'lucide-vue-next'

export interface SearchOption { value: string; label: string; subtitle?: string; image?: string }
const props = withDefaults(defineProps<{ modelValue: string; options: SearchOption[]; placeholder?: string; disabled?: boolean }>(), { placeholder: '请选择', disabled: false })
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [value: string] }>()
const open = ref(false)
const query = ref('')
const root = ref<HTMLElement>()
const input = ref<HTMLInputElement>()
const active = ref(0)
const selected = computed(() => props.options.find(option => option.value === props.modelValue))
const filtered = computed(() => {
  const key = query.value.trim().toLocaleLowerCase()
  return key ? props.options.filter(option => `${option.label} ${option.subtitle || ''}`.toLocaleLowerCase().includes(key)).slice(0, 300) : props.options.slice(0, 300)
})

watch(() => props.modelValue, () => { query.value = '' })
watch(filtered, () => { active.value = 0 })
function show() { if (props.disabled) return; open.value = true; nextTick(() => input.value?.focus()) }
function choose(value: string) { emit('update:modelValue', value); emit('change', value); open.value = false; query.value = '' }
function clear(event: Event) { event.stopPropagation(); choose('') }
function keydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') { event.preventDefault(); active.value = Math.min(filtered.value.length - 1, active.value + 1) }
  else if (event.key === 'ArrowUp') { event.preventDefault(); active.value = Math.max(0, active.value - 1) }
  else if (event.key === 'Enter' && filtered.value[active.value]) { event.preventDefault(); choose(filtered.value[active.value].value) }
  else if (event.key === 'Escape') open.value = false
}
function outside(event: MouseEvent) { if (!root.value?.contains(event.target as Node)) open.value = false }
document.addEventListener('mousedown', outside)
onBeforeUnmount(() => document.removeEventListener('mousedown', outside))
</script>

<template>
  <div ref="root" class="search-select" :class="{ open, disabled }">
    <button type="button" class="select-trigger" @click="show"><span>{{ selected?.label || placeholder }}</span><small v-if="selected?.subtitle">{{ selected.subtitle }}</small><X v-if="modelValue" :size="13" class="clear" @click="clear"/><ChevronDown :size="14"/></button>
    <div v-if="open" class="select-popover">
      <label><Search :size="15"/><input ref="input" v-model="query" :placeholder="`搜索${placeholder}`" @keydown="keydown"/></label>
      <div class="select-options">
        <button v-for="(option,index) in filtered" :key="option.value" type="button" :class="{ active:index===active, selected:option.value===modelValue }" @mouseenter="active=index" @click="choose(option.value)">
          <img v-if="option.image" :src="option.image"/><span><b>{{ option.label }}</b><small v-if="option.subtitle">{{ option.subtitle }}</small></span><Check v-if="option.value===modelValue" :size="14"/>
        </button>
        <p v-if="!filtered.length">没有匹配项</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-select{position:relative;min-width:0}.select-trigger{width:100%;min-height:34px;display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:6px;text-align:left;border:1px solid rgba(104,171,210,.34);background:#0d293c;color:#d8edf5;padding:7px 9px;cursor:pointer}.select-trigger>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.select-trigger>small{font-size:8px;color:#6f94a5}.clear{color:#648da1}.select-popover{position:absolute;z-index:500;left:0;right:0;top:calc(100% + 4px);min-width:280px;border:1px solid #3d7d9f;background:#0b2638;box-shadow:0 15px 40px rgba(0,0,0,.48)}.select-popover>label{height:39px;display:flex;align-items:center;gap:7px;padding:0 9px;border-bottom:1px solid rgba(92,160,199,.3)}.select-popover input{width:100%;border:0;outline:0;background:transparent;color:white}.select-options{max-height:330px;overflow:auto;padding:4px}.select-options>button{width:100%;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;border:0;background:transparent;color:#c3d9e2;text-align:left;padding:7px;cursor:pointer}.select-options>button:hover,.select-options>button.active{background:#174a68}.select-options>button.selected{color:#fff2b1}.select-options img{width:30px;height:30px;object-fit:cover;border:1px solid rgba(112,181,218,.3)}.select-options span{display:grid;min-width:0}.select-options b{font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.select-options small{font-size:8px;color:#7196a8;margin-top:2px}.select-options p{text-align:center;color:#668799;font-size:9px;padding:15px}.disabled{opacity:.5;pointer-events:none}
</style>
