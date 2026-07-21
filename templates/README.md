# Plantillas de asistentes

Las plantillas son datos versionados para asistentes nuevos. No cambian el
motor de chat ni reemplazan el `prompt` de clientes existentes.

Cada directorio de plantilla contiene:

- `template.json`: identidad, version, campos requeridos y capacidades.
- `questions.json`: preguntas breves para recopilar datos del negocio.
- `features.json`: capacidades declaradas por la plantilla.
- `prompt-base.txt`: comportamiento comun que se combina despues con datos
  validados del negocio.

El creador de asistentes de una fase posterior sera responsable de convertir
estas capacidades a los campos runtime ya soportados por `api/clients.js`.
Los documentos Redis existentes no se migran ni se leen desde esta carpeta.
