import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Brand, Card, FieldRow, PrimaryButton } from "../components/UI";
import { C } from "../theme";

export function HomeScreen({onOpenRoute}:{onOpenRoute:()=>void}) {
  const [role,setRole]=useState<"passenger"|"driver">("passenger");
  const cats=[
    ["Trabajo","briefcase-outline"],
    ["Universidad","school-outline"],
    ["FP y academias","book-outline"],
    ["Hospital","medical-outline"],
    ["Deporte","walk-outline"],
    ["Otros destinos","ellipsis-horizontal-circle-outline"],
  ] as const;

  return (
    <ScrollView contentContainerStyle={s.wrap} showsVerticalScrollIndicator={false}>
      <View style={s.top}>
        <Brand />
        <Ionicons name="notifications-outline" size={24} color={C.navy}/>
      </View>

      <Text style={s.title}>¿A dónde vamos?</Text>
      <Text style={s.subtitle}>Comparte tus trayectos entre pueblos.</Text>

      <View style={s.roles}>
        <Pressable onPress={()=>setRole("passenger")} style={[s.role,role==="passenger"&&s.roleActive]}>
          <Ionicons name="person" size={19} color={role==="passenger"?C.navy:C.muted}/>
          <Text style={[s.roleText,role==="passenger"&&s.roleTextActive]}>Soy pasajero</Text>
        </Pressable>
        <Pressable onPress={()=>setRole("driver")} style={[s.role,role==="driver"&&s.roleActive]}>
          <Ionicons name="car-sport-outline" size={20} color={role==="driver"?C.navy:C.muted}/>
          <Text style={[s.roleText,role==="driver"&&s.roleTextActive]}>Soy conductor</Text>
        </Pressable>
      </View>

      <View style={s.grid}>
        {cats.map(([label,icon])=>(
          <Pressable key={label} style={s.cat}>
            <Ionicons name={icon} size={30} color={label==="Hospital"?C.danger:C.blue}/>
            <Text style={s.catText}>{label}</Text>
            <Ionicons name="chevron-forward" size={14} color={C.text}/>
          </Pressable>
        ))}
      </View>

      <Card style={s.routeCard}>
        <FieldRow icon="location" title="Provincia" value="Sevilla" />
        <FieldRow icon="navigate-outline" title="Desde" value="Tu pueblo" />
        <FieldRow icon="flag" title="Hasta" value="Tu destino" />
        <View style={s.ok}>
          <Ionicons name="checkmark-circle" size={22} color={C.mint}/>
          <Text style={s.okText}>Siempre dentro de la misma provincia.</Text>
        </View>
      </Card>

      <PrimaryButton title="Buscar compañeros" onPress={onOpenRoute}/>
    </ScrollView>
  );
}

const s=StyleSheet.create({
  wrap:{paddingHorizontal:18,paddingTop:16,paddingBottom:28,backgroundColor:"#fff"},
  top:{flexDirection:"row",justifyContent:"space-between",alignItems:"center",marginBottom:18},
  title:{fontSize:31,fontWeight:"900",color:C.navy,letterSpacing:-.7},
  subtitle:{fontSize:15,color:C.muted,marginTop:3,marginBottom:18},
  roles:{flexDirection:"row",gap:10,marginBottom:16},
  role:{flex:1,height:46,borderRadius:14,borderWidth:1,borderColor:C.border,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:7,backgroundColor:"#fff"},
  roleActive:{backgroundColor:C.mintPale,borderColor:"#BCEEDC"},
  roleText:{fontSize:13,fontWeight:"700",color:C.muted},
  roleTextActive:{color:C.navy},
  grid:{flexDirection:"row",flexWrap:"wrap",gap:10,marginBottom:14},
  cat:{width:"48.5%",minHeight:88,borderWidth:1,borderColor:C.border,borderRadius:15,padding:12,backgroundColor:"#fff",justifyContent:"center"},
  catText:{fontSize:13,fontWeight:"800",color:C.navy,marginTop:7,marginRight:18},
  routeCard:{paddingVertical:0,overflow:"hidden"},
  ok:{flexDirection:"row",alignItems:"center",gap:8,paddingVertical:13,paddingHorizontal:5,backgroundColor:C.mintPale,marginTop:6,borderRadius:12},
  okText:{fontSize:12,fontWeight:"800",color:C.navy},
});
